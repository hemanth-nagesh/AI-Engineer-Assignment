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
# Ensure environment variables are set: GOOGLE_API_KEY, OPENWEATHERMAP_API_KEY, LANGCHAIN_API_KEY

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
    api_key = os.getenv("OPENWEATHERMAP_API_KEY")
    if not api_key:
        return "Error: OpenWeatherMap API key not found."
    
    base_url = "http://api.openweathermap.org/data/2.5/weather"
    params = {
        "q": city,
        "appid": api_key,
        "units": "metric"
    }
    
    try:
        response = requests.get(base_url, params=params)
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
    retriever = get_retriever()
    docs = retriever.invoke(query)
    return "\n\n".join([doc.page_content for doc in docs])

# --- Graph State ---

class AgentState(TypedDict):
    messages: list

# --- Nodes ---

# CHANGE 1: Using Google Gemini Model
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash",api_key=os.getenv("GOOGLE_API_KEY"))

# Bind tools to the LLM
tools = [get_weather, retrieve_knowledge]
llm_with_tools = llm.bind_tools(tools)

def agent_node(state: AgentState):
    """
    The main agent node (Router/Decider).
    Includes System Instruction.
    """
    messages = state["messages"]
    
    # CHANGE 2: Add System Instruction if it's not the first message
    # (Or strictly prepend it for the LLM context)
    # We construct a temporary list for the LLM call so we don't dirty the state history indefinitely with duplicate system prompts
    prompt_messages = [SystemMessage(content=SYSTEM_INSTRUCTION)] + messages
    
    response = llm_with_tools.invoke(prompt_messages)
    return {"messages": [response]}

def should_continue(state: AgentState) -> Literal["tools", "__end__"]:
    """
    Conditional edge logic.
    """
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return "__end__"

# --- Graph Construction ---

def build_graph():
    workflow = StateGraph(AgentState)

    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", ToolNode(tools))

    workflow.add_edge(START, "agent")
    
    workflow.add_conditional_edges(
        "agent",
        should_continue,
    )

    workflow.add_edge("tools", "agent")

    return workflow.compile()

# --- Wrapper for Usage ---

def process_query(user_input: str, thread_id: str = "1"):
    app = build_graph()
    
    config = {"configurable": {"thread_id": thread_id}}
    inputs = {"messages": [HumanMessage(content=user_input)]}
    
    final_response = ""
    for event in app.stream(inputs, config=config):
        for key, value in event.items():
            if key == "agent":
                msg = value["messages"][0]
                if not msg.tool_calls:
                    final_response = msg.content
    
    return final_response