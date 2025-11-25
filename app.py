import streamlit as st
import os
from Langgraph_Agent import ConversationManager
from RAG_Model import ingest_pdf

st.set_page_config(page_title="AI Agent Assignment", layout="wide")

st.title("🤖 LangGraph Agent: Weather & RAG (Google Gemini)")

# Sidebar for Setup
with st.sidebar:
    st.header("Configuration")
    
    # PDF Upload
    uploaded_file = st.file_uploader("Upload Knowledge Base (PDF)", type="pdf")
    if uploaded_file is not None:
        save_path = f"./{uploaded_file.name}"
        with open(save_path, "wb") as f:
            f.write(uploaded_file.getbuffer())
        
        if st.button("Process PDF"):
            with st.spinner("Ingesting PDF using Google Embeddings..."):
                try:
                    ingest_pdf(save_path)
                    st.success("PDF processed and stored in Qdrant!")
                except Exception as e:
                    st.error(f"Error: {e}")

    st.markdown("---")
    
    # Clear conversation button
    if st.button("🗑️ Clear Conversation", use_container_width=True):
        st.session_state.messages = []
        if "conversation_manager" in st.session_state:
            st.session_state.conversation_manager.clear_history()
        st.rerun()
    
    st.markdown("---")
    st.markdown("**Capabilities:**")
    st.markdown("- 🌦️ Real-time Weather")
    st.markdown("- 📄 Document QA (RAG)")
    st.markdown("- 💬 Multi-turn Conversations")
    st.markdown("---")
    st.info("Powered by Google Gemini 2.0 Flash")

# API Key Check
if not os.getenv("GOOGLE_API_KEY"):
    st.warning("⚠️ GOOGLE_API_KEY environment variable is not set.")
if not os.getenv("OPENWEATHERMAP_API_KEY"):
    st.warning("⚠️ OPENWEATHERMAP_API_KEY environment variable is not set.")

# Initialize ConversationManager in session state
if "conversation_manager" not in st.session_state:
    st.session_state.conversation_manager = ConversationManager(thread_id="streamlit_session")

# Initialize chat messages in session state
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat history
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# User Input
if prompt := st.chat_input("Ask about the weather or your PDF..."):
    # Add user message to history
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # Generate Response using ConversationManager
    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            try:
                # Use the conversation manager to maintain context
                response = st.session_state.conversation_manager.send_message(prompt)
                st.markdown(response)
                # Add assistant message to history
                st.session_state.messages.append({"role": "assistant", "content": response})
            except Exception as e:
                error_message = f"An error occurred: {str(e)}"
                st.error(error_message)
                st.session_state.messages.append({"role": "assistant", "content": error_message})

# Optional: Show conversation stats in sidebar
with st.sidebar:
    st.markdown("---")
    st.markdown("**Conversation Stats:**")
    st.markdown(f"Messages: {len(st.session_state.messages)}")
    if hasattr(st.session_state.conversation_manager, 'history'):
        st.markdown(f"Agent Memory: {len(st.session_state.conversation_manager.history)} items")