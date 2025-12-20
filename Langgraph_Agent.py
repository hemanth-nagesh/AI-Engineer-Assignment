import os
import requests
import logging
from typing import Annotated, Literal, Optional
from typing_extensions import TypedDict
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from RAG_Model_Mogodb import get_query_results as get_mongodb_retriever
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
openweathermap_api_key = os.getenv("OPENWEATHERMAP_API_KEY")
gemini_api_key = os.getenv("GOOGLE_API_KEY")
mongodb_url = os.getenv("MONGODB_URL")
use_mongodb = bool(mongodb_url)  # Use MongoDB if URL is provided


# --- Constants ---
SYSTEM_INSTRUCTION = """You are a helpful AI assistant. 
You have access to real-time weather data and a specific knowledge base (PDF) only.
- If the user asks about the weather, use the 'get_weather' tool.
- If the user asks a question that might be in the document (like stock market related details), use the 'retrieve_knowledge' tool.
- Always answer politely and concisely.
"""

# --- Tools ---

def get_weather(city: str):
    """
    Fetches real-time weather data for a specific city using OpenWeatherMap API.
    Args:
        city: The name of the city (e.g., 'London', 'New York').
    """
    logger.info(f"🌤️ Called weather model for {city}")
    
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
            humidity = data["main"]["humidity"]
            wind_speed = data["wind"]["speed"]
            result = f"The weather in {city} is currently {weather_desc} with a temperature of {temp}°C, humidity of {humidity}%, and wind speed of {wind_speed} m/s."
            return result
        else:
            return f"Error fetching weather: {data.get('message', 'Unknown error')}"
    except Exception as e:
        return f"Exception occurred: {str(e)}"


def retrieve_knowledge(query: str):
    """ get knowledge retrieval tool for stock market related questions
    arg: query string
    return: retrieved text from knowledge base
    """
    logger.info(f"📚 Called RAG model")
    try:
        result = get_mongodb_retriever(query)
        if not result:
            return "No relevant information found in the knowledge base."
        return result
    except Exception as e:
        return f"Error retrieving knowledge: {str(e)}"

# --- Graph State ---
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]

# --- Nodes ---

# Using Google Gemini Model
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
    """
    messages = state["messages"]
    
    # Prepare messages for Gemini
    prompt_messages = []
    system_added = False
    
    for msg in messages:
        if isinstance(msg, SystemMessage):
            continue
        elif isinstance(msg, HumanMessage) and not system_added:
            combined_content = f"{SYSTEM_INSTRUCTION}\n\nUser: {msg.content}"
            prompt_messages.append(HumanMessage(content=combined_content))
            system_added = True
        else:
            prompt_messages.append(msg)
    
    if not prompt_messages:
        prompt_messages = [HumanMessage(content=f"{SYSTEM_INSTRUCTION}\n\nUser: Hello")]
    
    try:
        response = llm_with_tools.invoke(prompt_messages)
        
        # Check if model decided to use tools
        if hasattr(response, 'tool_calls') and response.tool_calls:
            tool_names = [tool.get('name', 'unknown') for tool in response.tool_calls]
            logger.info(f"🔧 Agent invoked: {', '.join(tool_names)}")
        
        return {"messages": [response]}
    except Exception as e:
        error_msg = AIMessage(content=f"I encountered an error: {str(e)}")
        return {"messages": [error_msg]}

def should_continue(state: AgentState) -> Literal["tools", "__end__"]:
    """
    Conditional edge logic.
    """
    messages = state["messages"]
    if not messages:
        return "__end__"
    
    last_message = messages[-1]
    
    if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
        return "tools"
    
    return "__end__"

# --- Graph Construction ---

def build_graph():
    """
    Builds and returns the compiled LangGraph workflow.
    """
    workflow = StateGraph(AgentState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", ToolNode(tools))
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", should_continue)
    workflow.add_edge("tools", "agent")
    return workflow.compile()

# --- Global graph instance ---
_graph_instance = None

def get_graph():
    """Get or create the graph instance."""
    global _graph_instance
    if _graph_instance is None:
        _graph_instance = build_graph()
    return _graph_instance

# --- Helper function ---
def extract_text_from_response(content):
    """Extract clean text from various response formats."""
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        text_parts = []
        for item in content:
            if isinstance(item, dict) and 'text' in item:
                text_parts.append(item['text'])
            elif isinstance(item, str):
                text_parts.append(item)
        return ' '.join(text_parts) if text_parts else str(content)
    else:
        return str(content)

# --- Main query processing ---
def process_query(user_input: str):
    """
    Process a single user query through the agent graph.
    
    Args:
        user_input: The user's question or request
        
    Returns:
        The final response text from the agent
    """
    if not user_input or not user_input.strip():
        return "Please provide a valid question or request."
    
    try:
        app = get_graph()
        inputs = {"messages": [HumanMessage(content=user_input)]}
        final_response = ""
        
        config = {}
        
        for event in app.stream(inputs, config=config):
            for key, value in event.items():
                if key == "agent":
                    msg = value["messages"][-1]
                    if not hasattr(msg, 'tool_calls') or not msg.tool_calls:
                        if hasattr(msg, 'content'):
                            final_response = extract_text_from_response(msg.content)
        
        return final_response if final_response else "I couldn't generate a response. Please try again."
    
    except Exception as e:
        return f"An error occurred while processing your query: {str(e)}"


# --- Conversation Manager ---
class ConversationManager:
    """Helper class to manage multi-turn conversations."""
    
    def __init__(self, thread_id: str = "default"):
        self.thread_id = thread_id
        self.messages = []
    
    def send_message(self, user_input: str):
        """Send a message and get response while maintaining history."""
        if not user_input or not user_input.strip():
            return "Please provide a valid question or request."
        
        try:
            app = get_graph()
            self.messages.append(HumanMessage(content=user_input))
            inputs = {"messages": self.messages.copy()}
            final_response = ""
            
            config = {}
            
            for event in app.stream(inputs, config=config):
                for key, value in event.items():
                    if key == "agent":
                        msg = value["messages"][-1]
                        if not hasattr(msg, 'tool_calls') or not msg.tool_calls:
                            if hasattr(msg, 'content'):
                                final_response = extract_text_from_response(msg.content)
                            self.messages.append(msg)
                    elif key == "tools":
                        for tool_msg in value.get("messages", []):
                            self.messages.append(tool_msg)
            
            return final_response if final_response else "I couldn't generate a response. Please try again."
        
        except Exception as e:
            return f"An error occurred while processing your query: {str(e)}"
    
    def clear_history(self):
        """Clear conversation history."""
        self.messages = []
    
    def get_history(self):
        """Get current conversation history."""
        return self.messages
    
    def get_message_count(self):
        """Get the number of messages in history."""
        return len(self.messages)


# --- Evaluation Functions ---
def evaluate_response_quality(run_input: str, run_output: str, expected_keywords: Optional[list] = None) -> dict:
    """
    Custom evaluator for response quality.
    
    Args:
        run_input: The user query
        run_output: The agent's response
        expected_keywords: Optional list of keywords that should be in the response
        
    Returns:
        Dictionary with score and feedback
    """
    score = 0.0
    feedback = []
    
    # Check if response is not empty
    if run_output and len(run_output.strip()) > 0:
        score += 0.3
        feedback.append("Response generated")
    else:
        feedback.append("Empty response")
        return {"score": 0.0, "value": "FAIL", "comment": "; ".join(feedback)}
    
    # Check for error messages
    if "error" in run_output.lower() or "exception" in run_output.lower():
        score -= 0.2
        feedback.append("Contains error message")
    else:
        score += 0.2
        feedback.append("No errors")
    
    # Check response length (should be informative but concise)
    word_count = len(run_output.split())
    if 10 <= word_count <= 200:
        score += 0.3
        feedback.append(f"Good length ({word_count} words)")
    else:
        feedback.append(f"Length issue ({word_count} words)")
    
    # Check for expected keywords if provided
    if expected_keywords:
        found_keywords = [kw for kw in expected_keywords if kw.lower() in run_output.lower()]
        if found_keywords:
            score += 0.2
            feedback.append(f"Contains expected keywords: {', '.join(found_keywords)}")
        else:
            feedback.append("Missing expected keywords")
    else:
        score += 0.2  # Give benefit of doubt if no keywords provided
    
    # Determine overall value
    if score >= 0.8:
        value = "EXCELLENT"
    elif score >= 0.6:
        value = "GOOD"
    elif score >= 0.4:
        value = "FAIR"
    else:
        value = "POOR"
    
    result = {
        "score": min(max(score, 0.0), 1.0),  # Clamp between 0 and 1
        "value": value,
        "comment": "; ".join(feedback)
    }
    
    return result
