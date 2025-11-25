import os
import requests
from typing import Annotated, Literal, TypedDict
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END, START
from langgraph.prebuilt import ToolNode
from RAG_Model import get_retriever
from dotenv import load_dotenv

load_dotenv()

# --- Configuration ---
openweathermap_api_key = os.getenv("OPENWEATHERMAP_API_KEY")
gemini_api_key = os.getenv("GOOGLE_API_KEY")


class ConversationManager:
    """Helper class to manage multi-turn conversations."""
    
    def __init__(self, thread_id: str = "default"):
        self.thread_id = thread_id
        self.history = []
    
    def send_message(self, user_input: str):
        """Send a message and get response while maintaining history."""
        response, new_messages = process_query(user_input, self.thread_id, self.history)
        
        # Update history with new messages
        self.history.append(HumanMessage(content=user_input))
        self.history.extend(new_messages)
        
        return response
    
    def clear_history(self):
        """Clear conversation history."""
        self.history = []
    
    def get_history(self):
        """Get current conversation history."""
        return self.history
    
    
# --- Constants ---
SYSTEM_INSTRUCTION = """You are a helpful AI assistant. 
You have access to real-time weather data and a specific knowledge base (PDF).
- If the user asks about the weather, use the 'get_weather' tool.
- If the user asks a question that might be in the document (like specific codes, definitions, or assignment details), use the 'retrieve_knowledge' tool.
- Always answer politely and concisely.
"""

# --- Tools ---

@tool
def get_weather(city: str):
    """
    Fetches real-time weather data for a specific city using OpenWeatherMap API.
    Args:
        city: The name of the city (e.g., 'London', 'New York').
    """
    api_key = openweathermap_api_key
    if not api_key:
        return "Error: OpenWeatherMap API key not found."
    
    base_url = "http://api.openweathermap.org/data/2.5/weather"
    params = {
        "q": city,
        "appid": api_key,
        "units": "metric"
    }
    
    try:
        response = requests.get(base_url, params=params, timeout=10)
        data = response.json()
        
        if response.status_code == 200:
            weather_desc = data["weather"][0]["description"]
            temp = data["main"]["temp"]
            return f"The weather in {city} is currently {weather_desc} with a temperature of {temp}°C."
        else:
            return f"Error fetching weather: {data.get('message', 'Unknown error')}"
    except Exception as e:
        return f"Exception occurred: {str(e)}"

@tool
def retrieve_knowledge(query: str):
    """
    Retrieves information from the internal knowledge base (PDF) using RAG.
    Use this when asked about specific document content, policies, or stored knowledge.
    """
    try:
        retriever = get_retriever()
        docs = retriever.invoke(query)
        if not docs:
            return "No relevant information found in the knowledge base."
        return "\n\n".join([doc.page_content for doc in docs])
    except Exception as e:
        return f"Error retrieving knowledge: {str(e)}"

# --- Graph State ---

class AgentState(TypedDict):
    messages: list

# --- Nodes ---

# Using Google Gemini Model
# Note: We handle system instructions manually by combining with HumanMessage
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    api_key=gemini_api_key
)

# Bind tools to the LLM
tools = [get_weather, retrieve_knowledge]
llm_with_tools = llm.bind_tools(tools)

def agent_node(state: AgentState):
    """
    The main agent node (Router/Decider).
    Properly handles system instructions for Gemini API.
    Gemini requires both system context AND at least one human message.
    """
    messages = state["messages"]
    
    # Ensure we have at least one non-system message
    if not messages:
        raise ValueError("No messages provided to agent node")
    
    # CRITICAL FIX: Gemini doesn't support SystemMessage
    # We need to prepend system instruction to the FIRST HumanMessage only
    prompt_messages = []
    first_human_found = False
    
    for msg in messages:
        if isinstance(msg, SystemMessage):
            # Skip system messages - we'll prepend instructions to first human message
            continue
        elif isinstance(msg, HumanMessage):
            if not first_human_found:
                # For the FIRST human message only, prepend system instructions
                combined_content = f"{SYSTEM_INSTRUCTION}\n\nUser Query: {msg.content}"
                prompt_messages.append(HumanMessage(content=combined_content))
                first_human_found = True
            else:
                # All subsequent human messages go as-is
                prompt_messages.append(msg)
        else:
            # Keep AI messages, tool messages, and tool result messages as-is
            prompt_messages.append(msg)
    
    # Ensure we have at least one message
    if not prompt_messages:
        prompt_messages = [HumanMessage(content=f"{SYSTEM_INSTRUCTION}\n\nUser Query: Hello")]
    
    try:
        response = llm_with_tools.invoke(prompt_messages)
        return {"messages": [response]}
    except Exception as e:
        # Fallback: if error occurs, return error message
        error_msg = AIMessage(content=f"I encountered an error: {str(e)}")
        return {"messages": [error_msg]}

def should_continue(state: AgentState) -> Literal["tools", "__end__"]:
    """
    Conditional edge logic.
    Determines if we should call tools or end the conversation.
    """
    messages = state["messages"]
    if not messages:
        return "__end__"
    
    last_message = messages[-1]
    
    # Check if the last message has tool calls
    if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
        return "tools"
    return "__end__"

# --- Graph Construction ---

def build_graph():
    """
    Builds and returns the compiled LangGraph workflow.
    """
    workflow = StateGraph(AgentState)

    # Add nodes
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", ToolNode(tools))

    # Add edges
    workflow.add_edge(START, "agent")
    
    workflow.add_conditional_edges(
        "agent",
        should_continue,
    )

    workflow.add_edge("tools", "agent")

    return workflow.compile()

# --- Wrapper for Usage ---

# Global graph instance for conversation continuity
_graph_instance = None

def get_graph():
    """Get or create the graph instance."""
    global _graph_instance
    if _graph_instance is None:
        _graph_instance = build_graph()
    return _graph_instance

def process_query(user_input: str, thread_id: str = "1", conversation_history: list = None):
    """
    Process a user query through the agent graph.
    
    Args:
        user_input: The user's question or request
        thread_id: Optional thread identifier for conversation tracking
        conversation_history: Previous messages in the conversation (optional)
        
    Returns:
        The final response from the agent
    """
    if not user_input or not user_input.strip():
        return "Please provide a valid question or request."
    
    try:
        app = get_graph()
        
        config = {"configurable": {"thread_id": thread_id}}
        
        # Build messages list with conversation history
        messages = []
        if conversation_history:
            messages.extend(conversation_history)
        messages.append(HumanMessage(content=user_input))
        
        inputs = {"messages": messages}
        
        final_response = ""
        all_messages = []
        
        for event in app.stream(inputs, config=config):
            for key, value in event.items():
                if key == "agent":
                    msg = value["messages"][0]
                    all_messages.append(msg)
                    # Only capture final response (when no tool calls)
                    if not hasattr(msg, 'tool_calls') or not msg.tool_calls:
                        final_response = msg.content
                elif key == "tools":
                    # Capture tool results too
                    all_messages.extend(value.get("messages", []))
        
        return final_response if final_response else "I couldn't generate a response. Please try again.", all_messages
    
    except Exception as e:
        return f"An error occurred while processing your query: {str(e)}", []


