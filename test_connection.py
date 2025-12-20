#!/usr/bin/env python3
"""
Simple MongoDB connection test
"""

import os
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.server_api import ServerApi

def test_connection():
    """Test MongoDB connection"""
    load_dotenv()
    
    mongodb_url = os.getenv("MONGODB_URL")
    if not mongodb_url:
        print("❌ MONGODB_URL not found in environment variables")
        return False
    
    print(f"🔗 Testing MongoDB connection...")
    print(f"URL: {mongodb_url[:50]}...")
    
    try:
        # Connect with the same parameters as the main application
        client = MongoClient(
            mongodb_url, 
            server_api=ServerApi('1')
        )
        
        # Test the connection
        client.admin.command('ping')
        print("✅ MongoDB connection successful!")
        
        # Get server info
        server_info = client.server_info()
        print(f"📊 Server version: {server_info.get('version', 'Unknown')}")
        
        # List databases
        databases = client.list_database_names()
        print(f"📁 Available databases: {databases}")
        
        client.close()
        return True
        
    except Exception as e:
        print(f"❌ MongoDB connection failed: {str(e)}")
        return False

if __name__ == "__main__":
    success = test_connection()
    exit(0 if success else 1)