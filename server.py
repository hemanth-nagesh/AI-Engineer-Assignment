import os
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uuid
from Langgraph_Agent import ConversationManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('chat_logs.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Lifespan context manager for startup and shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup event
    logger.info("FastAPI server started successfully")
    yield
    # Shutdown event (if needed in future)
    logger.info("FastAPI server shutting down")

# Initialize FastAPI app
app = FastAPI(title="AI Chat Interface", version="1.0.0", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Connection manager for WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.conversation_managers: Dict[str, ConversationManager] = {}
    
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.conversation_managers[client_id] = ConversationManager(thread_id=client_id)
    
    def disconnect(self, websocket: WebSocket, client_id: str):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if client_id in self.conversation_managers:
            del self.conversation_managers[client_id]
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)
    
    async def broadcast_log(self, log_message: str, level: str = "INFO"):
        # Filter out only the most verbose messages but keep important logs
        if (not log_message.startswith('2025-') and
            "Response delivered to client_" not in log_message):
            
            log_data = {
                "type": "log",
                "message": log_message,
                "timestamp": datetime.now().isoformat(),
                "level": level
            }
            for connection in self.active_connections:
                try:
                    await connection.send_text(json.dumps(log_data))
                except:
                    # Connection might be closed, remove it
                    if connection in self.active_connections:
                        self.active_connections.remove(connection)
    
    async def broadcast_typing(self, client_id: str, is_typing: bool):
        typing_data = {
            "type": "typing",
            "client_id": client_id,
            "is_typing": is_typing,
            "timestamp": datetime.now().isoformat()
        }
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(typing_data))
            except:
                if connection in self.active_connections:
                    self.active_connections.remove(connection)

manager = ConnectionManager()

# Pydantic models
class Message(BaseModel):
    content: str
    client_id: str

class LogMessage(BaseModel):
    message: str
    level: str = "INFO"
    timestamp: str = None

# Custom logging handler to broadcast logs
class WebSocketLogHandler(logging.Handler):
    def __init__(self, manager):
        super().__init__()
        self.manager = manager
    
    def emit(self, record):
        try:
            log_message = self.format(record)
            asyncio.create_task(self.manager.broadcast_log(log_message))
        except Exception:
            pass

# Add WebSocket handler to logger
ws_handler = WebSocketLogHandler(manager)
ws_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))
logger.addHandler(ws_handler)

@app.get("/", response_class=HTMLResponse)
async def get_chat_page():
    """Serve the main chat page"""
    try:
        with open("static/index.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Chat UI not found. Please run the setup first.</h1>", status_code=404)

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for real-time communication"""
    await manager.connect(websocket, client_id)
    logger.info(f"✅ Client {client_id} connected successfully")
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            if message_data["type"] == "message":
                user_message = message_data["content"]
                
                # Broadcast typing indicator
                await manager.broadcast_typing(client_id, True)
                await manager.broadcast_log(f"📨 Processing message from {client_id}: {user_message[:50]}...")
                
                try:
                    # Get conversation manager for this client
                    conv_manager = manager.conversation_managers.get(client_id)
                    if not conv_manager:
                        await manager.broadcast_log(f"🆕 Creating new conversation for {client_id}")
                        conv_manager = ConversationManager(thread_id=client_id)
                        manager.conversation_managers[client_id] = conv_manager
                    
                    # Process the message using the existing agent
                    logger.info(f"🤖 Sending message to AI agent: {user_message}")
                    
                    # Log tool invocations based on message content
                    if "weather" in user_message.lower():
                        await manager.broadcast_log("🌤️ Called weather model")
                    elif any(keyword in user_message.lower() for keyword in ["stock", "market", "investment", "finance"]):
                        await manager.broadcast_log("📚 Called RAG model")
                    
                    # FIX: Run synchronous send_message in executor
                    loop = asyncio.get_event_loop()
                    response = await loop.run_in_executor(
                        None, 
                        conv_manager.send_message, 
                        user_message
                    )
                    
                    # Send response back to client
                    response_data = {
                        "type": "response",
                        "content": response,
                        "timestamp": datetime.now().isoformat(),
                        "client_id": client_id
                    }
                    
                    await websocket.send_text(json.dumps(response_data))
                    await manager.broadcast_log(f"✅ Response delivered to {client_id}")
                    
                except Exception as e:
                    error_message = f"Error processing message: {str(e)}"
                    logger.error(f"❌ {error_message}", exc_info=True)
                    
                    error_data = {
                        "type": "error",
                        "content": error_message,
                        "timestamp": datetime.now().isoformat()
                    }
                    await websocket.send_text(json.dumps(error_data))
                    await manager.broadcast_log(f"❌ Error for {client_id}: {error_message}", "ERROR")
                
                finally:
                    # Stop typing indicator
                    await manager.broadcast_typing(client_id, False)
            
            elif message_data["type"] == "typing":
                # Handle typing indicator
                is_typing = message_data.get("is_typing", False)
                await manager.broadcast_typing(client_id, is_typing)
            
            elif message_data["type"] == "ping":
                # Handle ping for connection health check
                pong_data = {"type": "pong", "timestamp": datetime.now().isoformat()}
                await websocket.send_text(json.dumps(pong_data))
    
    except WebSocketDisconnect:
        logger.info(f"🔌 Client {client_id} disconnected")
        manager.disconnect(websocket, client_id)
    except Exception as e:
        logger.error(f"❌ WebSocket error for client {client_id}: {str(e)}", exc_info=True)
        manager.disconnect(websocket, client_id)


@app.get('/api/health')
async def health_check():
    """Health check endpoint"""
    return JSONResponse(content={
        'status': 'OK',
        'message': 'Your API is running',
        'timestamp': datetime.now(timezone.utc).isoformat()
    })

@app.get("/api/logs")
async def get_recent_logs():
    """Get recent logs from the log file"""
    try:
        with open("chat_logs.log", "r", encoding="utf-8") as f:
            lines = f.readlines()
            # Return last 100 lines
            recent_logs = lines[-100:] if len(lines) > 100 else lines
            return {"logs": [line.strip() for line in recent_logs]}
    except FileNotFoundError:
        return {"logs": ["No logs available yet"]}

@app.get("/api/vector-store-info")
async def get_vector_store_info():
    """Get information about the current vector store"""
    try:
        mongodb_url = os.getenv("MONGODB_URL")
        if mongodb_url:
            return {
                "type": "mongodb",
                "configured": True,
                "message": "MongoDB vector store is configured and ready"
            }
        else:
            return {
                "type": "none",
                "configured": False,
                "message": "No vector store configured"
            }
    except Exception as e:
        logger.error(f"Vector store info error: {str(e)}")
        return {
            "type": "unknown",
            "configured": False,
            "error": str(e)
        }

# if __name__ == "__main__":
#     import uvicorn
#     uvicorn.run(app, host="0.0.0.0", port=8000)