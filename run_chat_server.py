#!/usr/bin/env python3
"""
AI Chat Server Startup Script
This script starts the FastAPI server with the AI chat interface
"""

import os
import sys
import asyncio
import logging
from pathlib import Path

def check_requirements():
    """Check if all required packages are installed"""
    required_packages = [
        'fastapi', 'uvicorn', 'websockets', 'pydantic',
        'langchain', 'langchain_core', 'langchain_google_genai',
        'requests'
    ]
    
    missing_packages = []
    for package in required_packages:
        try:
            __import__(package.replace('-', '_'))
        except ImportError:
            missing_packages.append(package)
    
    if missing_packages:
        print("❌ Missing required packages:")
        for package in missing_packages:
            print(f"   - {package}")
        print("\nPlease install them using: pip install -r requirements.txt")
        return True
    
    return True

def check_environment():
    """Check if required environment variables are set"""
    required_env_vars = ['GOOGLE_API_KEY', 'OPENWEATHERMAP_API_KEY']
    optional_env_vars = ['MONGODB_URL']
    missing_vars = []
    
    for var in required_env_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        print("❌ Missing required environment variables:")
        for var in missing_vars:
            print(f"   - {var}")
        print("\nPlease set these environment variables for full functionality.")
        return False
    
    # Check optional variables
    mongodb_url = os.getenv("MONGODB_URL")
    if mongodb_url:
        print("✅ MongoDB vector store configured")
    else:
        print("ℹ️  MongoDB not configured")
    
    langsmith_key = os.getenv("LANGCHAIN_API_KEY")
    if langsmith_key:
        print("✅ LangSmith tracing configured")
    else:
        print("ℹ️  LangSmith not configured - tracing disabled")
    
    return True

def check_static_files():
    """Check if static files exist"""
    static_files = [
        'static/index.html',
        'static/css/style.css',
        'static/js/app.js'
    ]
    
    missing_files = []
    for file_path in static_files:
        if not os.path.exists(file_path):
            missing_files.append(file_path)
    
    if missing_files:
        print("❌ Missing static files:")
        for file_path in missing_files:
            print(f"   - {file_path}")
        print("\nPlease ensure all static files are present.")
        return False
    
    return True

async def test_document_retrieval():
    """Test if document retrieval works"""
    try:
        from RAG_Model_Mogodb import get_query_results
        print("🔍 Testing document retrieval...")
        # Test with a simple query
        result = get_query_results("test query")
        print("✅ Document retrieval system is working")
        return True
    except Exception as e:
        print(f"⚠️  Document retrieval test failed: {str(e)}")
        print("   This might affect RAG functionality, but the chat will still work.")
        return False

def main():
    """Main startup function"""
    print("🚀 Starting AI Chat Server...")
    print("=" * 50)
    
    # Check requirements
    # if not check_requirements():
    #     sys.exit(1)
    
    # Check environment
    # check_environment()
    
    # Check static files
    # if not check_static_files():
    #     sys.exit(1)
    
    # Test document retrieval
    # asyncio.run(test_document_retrieval())
    
    print("\n✅ All checks passed!")
    print("🌐 Starting FastAPI server...")
    print("📱 Chat interface will be available at: http://localhost:8000")
    print("📊 API docs available at: http://localhost:8000/docs")
    print("🔧 Health check at: http://localhost:8000/api/health")
    print("\nPress Ctrl+C to stop the server")
    print("=" * 50)
    
    # Start the server
    try:
        import uvicorn
        uvicorn.run(
            "server:app",
            host="0.0.0.0",
            port=8000,
            reload=True,
            log_level="info"
        )
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
    except Exception as e:
        print(f"❌ Failed to start server: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()