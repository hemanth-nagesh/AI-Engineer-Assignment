import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models
from dotenv import load_dotenv

load_dotenv()
# Constants
COLLECTION_NAME = "ai_assignment_docs"
VECTOR_DB_PATH = "./qdrant_db"  # Local storage for persistence

def initialize_vector_store():
    """
    Initializes and returns the Qdrant vector store using Google Embeddings.
    """
    # CHANGE 1: Using Google Generative AI Embeddings
    embeddings = GoogleGenerativeAIEmbeddings(model="models/text-embedding-004", api_key=os.getenv("GOOGLE_API_KEY"))
    
    # Initialize Qdrant Client (Local mode)
    client = QdrantClient(path=VECTOR_DB_PATH)
    
    # Check if collection exists, if not create it
    collections = client.get_collections().collections
    collection_names = [c.name for c in collections]
    
    if COLLECTION_NAME not in collection_names:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=models.VectorParams(size=768, distance=models.Distance.COSINE), 
            # Note: embedding-001 dimension is 768. text-embedding-004 is also 768.
        )

    vector_store = QdrantVectorStore(
        client=client,
        collection_name=COLLECTION_NAME,
        embedding=embeddings,
    )
    return vector_store

def ingest_pdf(file_path):
    """
    Ingests a PDF file, splits it, and stores embeddings in Qdrant.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File {file_path} not found.")

    print(f"Loading {file_path}...")
    loader = PyPDFLoader(file_path)
    docs = loader.load()

    print("Splitting documents...")
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        add_start_index=True
    )
    splits = text_splitter.split_documents(docs)

    print(f"Generating embeddings and storing {len(splits)} chunks in Qdrant...")
    vector_store = initialize_vector_store()
    vector_store.add_documents(documents=splits)
    print("Ingestion complete.")

def get_retriever():
    """
    Returns a retriever interface for the vector store.
    """
    vector_store = initialize_vector_store()
    return vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 3})


if __name__ == "__main__":
    # For standalone execution to setup DB
    ingest_pdf("Stock Market.pdf")