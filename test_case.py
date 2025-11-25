import pytest
import os
from unittest.mock import Mock, patch, MagicMock
from langchain_core.messages import HumanMessage, AIMessage
from Langgraph_Agent import (
    get_weather,
    retrieve_knowledge,
    process_query,
    ConversationManager,
    extract_text_from_response,
    evaluate_response_quality
)


# FIXTURES

@pytest.fixture
def mock_weather_response():
    """Mock successful weather API response"""
    return {
        "weather": [{"description": "clear sky"}],
        "main": {"temp": 20.5}
    }

@pytest.fixture
def mock_weather_error_response():
    """Mock error weather API response"""
    return {
        "message": "city not found",
        "cod": "404"
    }

@pytest.fixture
def mock_retriever_docs():
    """Mock retriever documents"""
    mock_doc1 = Mock()
    mock_doc1.page_content = "Stocks are equity investments in companies."
    
    mock_doc2 = Mock()
    mock_doc2.page_content = "Bonds are fixed-income securities."
    
    return [mock_doc1, mock_doc2]

@pytest.fixture
def conversation_manager():
    """Create a fresh ConversationManager instance"""
    return ConversationManager(thread_id="test-thread")


# TEST SUITE 1: API HANDLING TESTS

class TestWeatherAPIHandling:
    """Test suite for weather API integration"""
    
    @patch('Langgraph_Agent.requests.get')
    def test_get_weather_success(self, mock_get, mock_weather_response):
        """Test successful weather API call"""
        # Setup mock
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = mock_weather_response
        mock_get.return_value = mock_response
        
        # Execute
        result = get_weather.invoke({"city": "London"})
        
        # Verify
        assert "London" in result
        assert "clear sky" in result
        assert "20.5" in result
        mock_get.assert_called_once()
    
    @patch('Langgraph_Agent.requests.get')
    def test_get_weather_city_not_found(self, mock_get, mock_weather_error_response):
        """Test weather API with invalid city"""
        # Setup mock
        mock_response = Mock()
        mock_response.status_code = 404
        mock_response.json.return_value = mock_weather_error_response
        mock_get.return_value = mock_response
        
        # Execute
        result = get_weather.invoke({"city": "InvalidCity123"})
        
        # Verify
        assert "Error fetching weather" in result
        assert "city not found" in result.lower()
    
    @patch('Langgraph_Agent.requests.get')
    def test_get_weather_network_error(self, mock_get):
        """Test weather API with network error"""
        # Setup mock to raise exception
        mock_get.side_effect = Exception("Network timeout")
        
        # Execute
        result = get_weather.invoke({"city": "London"})
        
        # Verify
        assert "Exception occurred" in result
        assert "Network timeout" in result
    
    @patch('Langgraph_Agent.openweathermap_api_key', None)
    def test_get_weather_missing_api_key(self):
        """Test weather API without API key"""
        # Execute
        result = get_weather.invoke({"city": "London"})
        
        # Verify
        assert "Error: OpenWeatherMap API key not found" in result
    
    @patch('Langgraph_Agent.requests.get')
    def test_get_weather_timeout(self, mock_get):
        """Test weather API timeout handling"""
        # Setup mock to raise timeout
        import requests
        mock_get.side_effect = requests.Timeout("Request timed out")
        
        # Execute
        result = get_weather.invoke({"city": "London"})
        
        # Verify
        assert "Exception occurred" in result
        assert "timed out" in result.lower()


# TEST SUITE 2: RAG RETRIEVAL TESTS

class TestRAGRetrieval:
    """Test suite for RAG knowledge retrieval"""
    
    @patch('Langgraph_Agent.get_retriever')
    def test_retrieve_knowledge_success(self, mock_get_retriever, mock_retriever_docs):
        """Test successful knowledge retrieval"""
        # Setup mock
        mock_retriever = Mock()
        mock_retriever.invoke.return_value = mock_retriever_docs
        mock_get_retriever.return_value = mock_retriever
        
        # Execute
        result = retrieve_knowledge.invoke({"query": "types of investments"})
        
        # Verify
        assert "Stocks are equity investments" in result
        assert "Bonds are fixed-income securities" in result
        mock_retriever.invoke.assert_called_once_with("types of investments")
    
    @patch('Langgraph_Agent.get_retriever')
    def test_retrieve_knowledge_no_results(self, mock_get_retriever):
        """Test knowledge retrieval with no results"""
        # Setup mock
        mock_retriever = Mock()
        mock_retriever.invoke.return_value = []
        mock_get_retriever.return_value = mock_retriever
        
        # Execute
        result = retrieve_knowledge.invoke({"query": "unknown topic"})
        
        # Verify
        assert "No relevant information found" in result
    
    @patch('Langgraph_Agent.get_retriever')
    def test_retrieve_knowledge_error(self, mock_get_retriever):
        """Test knowledge retrieval with error"""
        # Setup mock to raise exception
        mock_get_retriever.side_effect = Exception("Database connection failed")
        
        # Execute
        result = retrieve_knowledge.invoke({"query": "test query"})
        
        # Verify
        assert "Error retrieving knowledge" in result
        assert "Database connection failed" in result
    
    @patch('Langgraph_Agent.get_retriever')
    def test_retrieve_knowledge_multiple_docs(self, mock_get_retriever):
        """Test knowledge retrieval with multiple documents"""
        # Setup mock with 5 documents
        mock_docs = [Mock(page_content=f"Content {i}") for i in range(5)]
        mock_retriever = Mock()
        mock_retriever.invoke.return_value = mock_docs
        mock_get_retriever.return_value = mock_retriever
        
        # Execute
        result = retrieve_knowledge.invoke({"query": "comprehensive query"})
        
        # Verify
        for i in range(5):
            assert f"Content {i}" in result
        assert result.count("\n\n") == 4  # 5 docs means 4 separators


# TEST SUITE 3: LLM PROCESSING TESTS

class TestLLMProcessing:
    """Test suite for LLM processing logic"""
    
    def test_extract_text_from_string(self):
        """Test text extraction from string"""
        result = extract_text_from_response("Simple text response")
        assert result == "Simple text response"
    
    def test_extract_text_from_list_of_dicts(self):
        """Test text extraction from list of dicts"""
        content = [
            {"text": "First part"},
            {"text": "Second part"},
            {"other": "ignored"}
        ]
        result = extract_text_from_response(content)
        assert "First part" in result
        assert "Second part" in result
    
    def test_extract_text_from_mixed_list(self):
        """Test text extraction from mixed list"""
        content = [
            "Direct string",
            {"text": "Dict text"},
            {"no_text": "ignored"}
        ]
        result = extract_text_from_response(content)
        assert "Direct string" in result
        assert "Dict text" in result
    
    def test_extract_text_from_empty_list(self):
        """Test text extraction from empty list"""
        result = extract_text_from_response([])
        assert result == "[]"
    
    def test_extract_text_from_other_types(self):
        """Test text extraction from other types"""
        assert extract_text_from_response(123) == "123"
        assert extract_text_from_response(None) == "None"


# TEST SUITE 4: CONVERSATION MANAGER TESTS

class TestConversationManager:
    """Test suite for ConversationManager"""
    
    def test_initialization(self, conversation_manager):
        """Test ConversationManager initialization"""
        assert conversation_manager.thread_id == "test-thread"
        assert conversation_manager.messages == []
        assert conversation_manager.get_message_count() == 0
    
    def test_clear_history(self, conversation_manager):
        """Test clearing conversation history"""
        # Add some messages
        conversation_manager.messages = [
            HumanMessage(content="Test"),
            AIMessage(content="Response")
        ]
        
        # Clear
        conversation_manager.clear_history()
        
        # Verify
        assert len(conversation_manager.messages) == 0
        assert conversation_manager.get_message_count() == 0
    
    def test_get_history(self, conversation_manager):
        """Test getting conversation history"""
        # Add messages
        msg1 = HumanMessage(content="Hello")
        msg2 = AIMessage(content="Hi there")
        conversation_manager.messages = [msg1, msg2]
        
        # Get history
        history = conversation_manager.get_history()
        
        # Verify
        assert len(history) == 2
        assert history[0] == msg1
        assert history[1] == msg2
    
    def test_message_count_increments(self, conversation_manager):
        """Test that message count increments correctly"""
        assert conversation_manager.get_message_count() == 0
        
        conversation_manager.messages.append(HumanMessage(content="Test"))
        assert conversation_manager.get_message_count() == 1
        
        conversation_manager.messages.append(AIMessage(content="Response"))
        assert conversation_manager.get_message_count() == 2


# TEST SUITE 5: EVALUATION TESTS

class TestEvaluation:
    """Test suite for response evaluation"""
    
    def test_evaluate_quality_excellent_response(self):
        """Test evaluation of excellent response"""
        result = evaluate_response_quality(
            run_input="What is AI?",
            run_output="Artificial Intelligence is the simulation of human intelligence by machines. It includes machine learning and deep learning.",
            expected_keywords=["intelligence", "machine learning"]
        )
        
        assert result["score"] >= 0.8
        assert result["value"] == "EXCELLENT"
        assert "expected keywords" in result["comment"]
    
    def test_evaluate_quality_empty_response(self):
        """Test evaluation of empty response"""
        result = evaluate_response_quality(
            run_input="Test",
            run_output="",
            expected_keywords=None
        )
        
        assert result["score"] == 0.0
        assert result["value"] == "FAIL"
        assert "Empty response" in result["comment"]
    
    def test_evaluate_quality_error_response(self):
        """Test evaluation of error response"""
        result = evaluate_response_quality(
            run_input="Test",
            run_output="An error occurred while processing your request",
            expected_keywords=None
        )
        
        assert result["score"] < 0.6
        assert "error message" in result["comment"]
    
    def test_evaluate_quality_short_response(self):
        """Test evaluation of too short response"""
        result = evaluate_response_quality(
            run_input="Test",
            run_output="Yes",
            expected_keywords=None
        )
        
        assert "Length issue" in result["comment"]
    
    def test_evaluate_quality_long_response(self):
        """Test evaluation of too long response"""
        long_text = " ".join(["word"] * 250)
        result = evaluate_response_quality(
            run_input="Test",
            run_output=long_text,
            expected_keywords=None
        )
        
        assert "Length issue" in result["comment"]
    
    def test_evaluate_quality_good_length(self):
        """Test evaluation of good length response"""
        good_text = " ".join(["word"] * 50)
        result = evaluate_response_quality(
            run_input="Test",
            run_output=good_text,
            expected_keywords=None
        )
        
        assert "Good length" in result["comment"]
    
    def test_evaluate_quality_missing_keywords(self):
        """Test evaluation with missing keywords"""
        result = evaluate_response_quality(
            run_input="Test",
            run_output="This is a response without the expected words.",
            expected_keywords=["specific", "keyword"]
        )
        
        assert "Missing expected keywords" in result["comment"]


# TEST SUITE 6: INTEGRATION TESTS

class TestIntegration:
    """Integration tests for the complete system"""
    
    def test_process_query_empty_input(self):
        """Test process_query with empty input"""
        result = process_query("")
        assert "Please provide a valid question" in result
        
        result = process_query("   ")
        assert "Please provide a valid question" in result
    
    @patch('Langgraph_Agent.get_graph')
    def test_process_query_with_exception(self, mock_get_graph):
        """Test process_query handling exceptions"""
        # Setup mock to raise exception
        mock_get_graph.side_effect = Exception("Graph build failed")
        
        # Execute
        result = process_query("test query")
        
        # Verify
        assert "An error occurred" in result
        assert "Graph build failed" in result
    
    def test_conversation_manager_empty_input(self, conversation_manager):
        """Test ConversationManager with empty input"""
        result = conversation_manager.send_message("")
        assert "Please provide a valid question" in result
        
        result = conversation_manager.send_message("  ")
        assert "Please provide a valid question" in result


# TEST SUITE 7: ERROR HANDLING TESTS

class TestErrorHandling:
    """Test suite for error handling scenarios"""
    
    @patch('Langgraph_Agent.requests.get')
    def test_weather_api_malformed_response(self, mock_get):
        """Test handling of malformed weather API response"""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"unexpected": "format"}
        mock_get.return_value = mock_response
        
        # Should handle KeyError gracefully
        result = get_weather.invoke({"city": "London"})
        assert "Exception occurred" in result
    
    @patch('Langgraph_Agent.get_retriever')
    def test_rag_retrieval_partial_failure(self, mock_get_retriever):
        """Test RAG with some docs having no content"""
        mock_doc1 = Mock(page_content="Valid content")
        mock_doc2 = Mock(page_content="")
        mock_doc3 = Mock(page_content="More content")
        
        mock_retriever = Mock()
        mock_retriever.invoke.return_value = [mock_doc1, mock_doc2, mock_doc3]
        mock_get_retriever.return_value = mock_retriever
        
        result = retrieve_knowledge.invoke({"query": "test"})
        assert "Valid content" in result
        assert "More content" in result


# RUN TESTS

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
