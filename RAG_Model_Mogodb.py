from google import genai
from google.genai import types
from pymongo import MongoClient

import os
from dotenv import load_dotenv

load_dotenv()

# Initialize the GenAI client (ensure GOOGLE_API_KEY is in your environment variables)
genai_client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))
# Connect to your MongoDB deployment
DB_URL = os.getenv("MONGODB_URL")
mongo_client = None
collection = None

try:
    if DB_URL:
        mongo_client = MongoClient(DB_URL)
        # Test the connection
        mongo_client.admin.command('ping')
        collection = mongo_client["sample_mflix"]["ragpdf"]
        print("MongoDB connection successful")
        # print(collection)
except Exception as e:
    print(f"Warning: MongoDB connection failed: {e}")
    mongo_client = None
    collection = None

def get_embedding(text):
    """
    Generates an embedding using text-embedding-004.
    
    Args:
        text (str): The text to embed.
    Returns:
        list: The embedding vector.
    """
    response = genai_client.models.embed_content(
        model="text-embedding-004",
        contents=text,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY"
        )
    )
    
    # The new SDK returns an object, not a dict. 
    # Access .embeddings list, then the first item, then .values
    return response.embeddings[0].values


# Define a function to run vector search queries
def get_query_results(query):
    """Gets results from a vector search query."""
    if collection is None:
        print("Warning: MongoDB collection not initialized, returning empty results")
        return ""
    
    print("Getting results for query:", query)
    query_embedding = get_embedding(query)
    print("Query Embedding done")
    pipeline = [
        {
                "$vectorSearch": {
                "index": "vector_index",
                "queryVector": query_embedding,
                "path": "embedding",
                "numCandidates":768,
                "limit": 5
                }
        }, {
                "$project": {
                "_id": 0,
                "text": 1
            }
        }
    ]

    results = collection.aggregate(pipeline)
    print(results)

    array_of_results = []
    for doc in results:
        array_of_results.append(doc)
    context_string = " ".join([doc["text"] for doc in array_of_results])
    return context_string

# if __name__ == "__main__":
#     query = "What is stock market?"
#     print(get_query_results(query))