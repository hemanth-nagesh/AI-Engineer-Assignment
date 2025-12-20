class ChatApp {
    constructor() {
        this.ws = null;
        this.clientId = this.generateClientId();
        this.isConnected = false;
        this.messageCount = 0;
        this.connectionStartTime = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        this.initializeElements();
        this.bindEvents();
        this.loadCachedMessages();
        this.connect();
        this.startConnectionTimer();
    }

    generateClientId() {
        return 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    initializeElements() {
        // Connection elements
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        this.loadingOverlay = document.getElementById('loading-overlay');
        
        // Chat elements
        this.chatMessages = document.getElementById('chat-messages');
        this.messageInput = document.getElementById('message-input');
        this.sendButton = document.getElementById('send-button');
        this.clearChatBtn = document.getElementById('clear-chat');
        this.typingIndicator = document.getElementById('typing-indicator');
        this.charCount = document.getElementById('char-count');
        
        // Logs elements
        this.logsContainer = document.getElementById('logs-container');
        this.toggleLogsBtn = document.getElementById('toggle-logs');
        this.clearLogsBtn = document.getElementById('clear-logs');
        
        // Footer elements
        this.messageCountEl = document.getElementById('message-count');
        this.connectionTimeEl = document.getElementById('connection-time');
        
        // Modal elements
        this.errorModal = document.getElementById('error-modal');
        this.errorMessage = document.getElementById('error-message');
        
        // Quick action buttons
        this.quickActions = document.querySelectorAll('.quick-action');
    }

    bindEvents() {
        // Message input events
        this.messageInput.addEventListener('input', () => this.updateCharCount());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.clearChatBtn.addEventListener('click', () => this.clearChat());
        
        // Logs events
        this.toggleLogsBtn.addEventListener('click', () => this.toggleLogs());
        this.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        
        // Quick action events
        this.quickActions.forEach(btn => {
            btn.addEventListener('click', () => {
                const message = btn.getAttribute('data-message');
                this.messageInput.value = message;
                this.updateCharCount();
                this.messageInput.focus();
            });
        });
        
        // Modal events
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => this.hideModal());
        });
        
        this.errorModal.addEventListener('click', (e) => {
            if (e.target === this.errorModal) {
                this.hideModal();
            }
        });
        
        // Window events
        window.addEventListener('beforeunload', () => {
            if (this.ws) {
                this.ws.close();
            }
        });
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/${this.clientId}`;
        
        this.addLog('Connecting to server...', 'INFO');
        this.showLoading(true);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => this.onConnectionOpen();
            this.ws.onmessage = (event) => this.onMessage(event);
            this.ws.onclose = () => this.onConnectionClose();
            this.ws.onerror = (error) => this.onConnectionError(error);
            
        } catch (error) {
            this.addLog(`Connection error: ${error.message}`, 'ERROR');
            this.showError('Failed to connect to server');
            this.showLoading(false);
        }
    }

    onConnectionOpen() {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.connectionStartTime = Date.now();
        
        this.updateConnectionStatus(true);
        this.showLoading(false);
        this.addLog('Connected to server successfully', 'INFO');
        
        // Start ping interval for connection health
        this.startPingInterval();
    }

    onMessage(event) {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'response':
                    this.addMessage(data.content, 'assistant', data.timestamp);
                    this.hideTypingIndicator();
                    break;
                    
                case 'log':
                    this.addLog(data.message, data.level, data.timestamp);
                    break;
                    
                case 'typing':
                    this.handleTypingIndicator(data.client_id, data.is_typing);
                    break;
                    
                case 'error':
                    this.addMessage(data.content, 'error', data.timestamp);
                    this.hideTypingIndicator();
                    break;
                    
                case 'pong':
                    // Ping received, connection is healthy
                    break;
                    
                default:
                    this.addLog(`Unknown message type: ${data.type}`, 'WARNING');
            }
        } catch (error) {
            this.addLog(`Failed to parse message: ${error.message}`, 'ERROR');
        }
    }

    onConnectionClose() {
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.addLog('Disconnected from server', 'INFO');
        this.hideTypingIndicator();
        
        // Clear ping interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        
        // Attempt to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            this.addLog(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, 'INFO');
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            this.addLog('Max reconnection attempts reached', 'ERROR');
            this.showError('Connection lost. Please refresh the page.');
        }
    }

    onConnectionError(error) {
        this.addLog(`WebSocket error: ${error.message || 'Unknown error'}`, 'ERROR');
        this.updateConnectionStatus(false);
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        
        if (!message) {
            return;
        }
        
        if (!this.isConnected) {
            this.showError('Not connected to server');
            return;
        }
        
        // Add user message to chat
        this.addMessage(message, 'user');
        this.messageCount++;
        this.updateMessageCount();
        
        // Clear input
        this.messageInput.value = '';
        this.updateCharCount();
        
        // Send to server
        const messageData = {
            type: 'message',
            content: message,
            client_id: this.clientId
        };
        
        try {
            this.ws.send(JSON.stringify(messageData));
            this.showTypingIndicator();
        } catch (error) {
            this.addLog(`Failed to send message: ${error.message}`, 'ERROR');
            this.showError('Failed to send message');
        }
    }

    addMessage(content, type, timestamp = null) {
        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        this.addMessageToDOM(content, type, time);
        
        // Save to cache after adding a new message
        this.saveMessagesToCache();
    }

    addLog(message, level = 'INFO', timestamp = null) {
        const logEl = document.createElement('div');
        logEl.className = 'log-entry';
        
        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        
        logEl.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-level">${level}</span>
            <span class="log-message">${this.escapeHtml(message)}</span>
        `;
        
        this.logsContainer.appendChild(logEl);
        
        // Keep only last 100 logs
        const logs = this.logsContainer.querySelectorAll('.log-entry');
        if (logs.length > 100) {
            logs[0].remove();
        }
        
        // Auto-scroll to bottom
        this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
    }

    handleTypingIndicator(clientId, isTyping) {
        // Only show typing indicator for other clients
        if (clientId !== this.clientId && isTyping) {
            this.showTypingIndicator();
        } else if (clientId !== this.clientId && !isTyping) {
            this.hideTypingIndicator();
        }
    }

    showTypingIndicator() {
        this.typingIndicator.classList.add('active');
    }

    hideTypingIndicator() {
        this.typingIndicator.classList.remove('active');
    }

    updateConnectionStatus(connected) {
        if (connected) {
            this.statusIndicator.classList.remove('offline');
            this.statusIndicator.classList.add('online');
            this.statusText.textContent = 'Connected';
        } else {
            this.statusIndicator.classList.remove('online');
            this.statusIndicator.classList.add('offline');
            this.statusText.textContent = 'Disconnected';
        }
    }

    updateCharCount() {
        const length = this.messageInput.value.length;
        this.charCount.textContent = `${length} / 1000`;
        
        if (length > 900) {
            this.charCount.style.color = 'var(--warning-color)';
        } else if (length >= 1000) {
            this.charCount.style.color = 'var(--error-color)';
        } else {
            this.charCount.style.color = 'var(--text-muted)';
        }
    }

    updateMessageCount() {
        this.messageCountEl.textContent = this.messageCount;
    }

    startConnectionTimer() {
        setInterval(() => {
            if (this.isConnected && this.connectionStartTime) {
                const elapsed = Date.now() - this.connectionStartTime;
                const minutes = Math.floor(elapsed / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);
                this.connectionTimeEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
                this.connectionTimeEl.textContent = '--:--';
            }
        }, 1000);
    }

    startPingInterval() {
        this.pingInterval = setInterval(() => {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000); // Ping every 30 seconds
    }

    clearChat() {
        this.chatMessages.innerHTML = `
            <div class="welcome-message">
                <i class="fas fa-hand-wave"></i>
                <h3>Chat Cleared!</h3>
                <p>Start a new conversation...</p>
            </div>
        `;
        this.messageCount = 0;
        this.updateMessageCount();
        
        // Clear the cache when chat is cleared
        this.clearMessageCache();
    }

    toggleLogs() {
        const logsSection = document.querySelector('.logs-section');
        logsSection.classList.toggle('hidden');
        
        const icon = this.toggleLogsBtn.querySelector('i');
        if (logsSection.classList.contains('hidden')) {
            icon.className = 'fas fa-eye-slash';
        } else {
            icon.className = 'fas fa-eye';
        }
    }

    clearLogs() {
        this.logsContainer.innerHTML = `
            <div class="log-entry info">
                <span class="log-time">System</span>
                <span class="log-level">INFO</span>
                <span class="log-message">Logs cleared</span>
            </div>
        `;
    }

    showLoading(show) {
        if (show) {
            this.loadingOverlay.classList.remove('hidden');
        } else {
            this.loadingOverlay.classList.add('hidden');
        }
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorModal.classList.add('active');
    }

    hideModal() {
        this.errorModal.classList.remove('active');
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // localStorage functions for caching messages
    saveMessagesToCache() {
        try {
            const messages = [];
            const messageElements = this.chatMessages.querySelectorAll('.message');
            
            console.log(`Saving ${messageElements.length} messages to cache`);
            
            messageElements.forEach(el => {
                const type = el.classList.contains('user') ? 'user' :
                             el.classList.contains('assistant') ? 'assistant' : 'error';
                const textEl = el.querySelector('.message-text');
                const timeEl = el.querySelector('.message-time');
                
                if (textEl && timeEl) {
                    messages.push({
                        type: type,
                        content: textEl.textContent,
                        timestamp: timeEl.textContent
                    });
                }
            });
            
            localStorage.setItem('chatMessages', JSON.stringify(messages));
            localStorage.setItem('messageCount', this.messageCount.toString());
            console.log('Messages saved to cache:', messages.length);
        } catch (error) {
            console.error('Error saving messages to cache:', error);
        }
    }

    loadCachedMessages() {
        try {
            const cachedMessages = localStorage.getItem('chatMessages');
            const cachedCount = localStorage.getItem('messageCount');
            
            console.log('Loading cached messages...');
            
            if (cachedMessages) {
                const messages = JSON.parse(cachedMessages);
                console.log(`Found ${messages.length} cached messages`);
                
                // Remove welcome message if it exists
                const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
                if (welcomeMessage) {
                    welcomeMessage.remove();
                }
                
                // Load cached messages
                messages.forEach(msg => {
                    this.addMessageToDOM(msg.content, msg.type, msg.timestamp);
                });
                
                // Update message count
                if (cachedCount) {
                    this.messageCount = parseInt(cachedCount, 10);
                    this.updateMessageCount();
                }
                
                // Save the loaded state to ensure it persists
                this.saveMessagesToCache();
                console.log('Cached messages loaded successfully');
            } else {
                console.log('No cached messages found');
            }
        } catch (error) {
            console.error('Error loading cached messages:', error);
        }
    }

    clearMessageCache() {
        try {
            console.log('Clearing message cache...');
            localStorage.removeItem('chatMessages');
            localStorage.removeItem('messageCount');
            console.log('Message cache cleared successfully');
        } catch (error) {
            console.error('Error clearing message cache:', error);
        }
    }

    addMessageToDOM(content, type, timestamp = null) {
        // Remove welcome message if it exists
        const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
        
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        
        const time = timestamp || new Date().toLocaleTimeString();
        
        let avatarIcon = '';
        if (type === 'user') {
            avatarIcon = '<i class="fas fa-user"></i>';
        } else if (type === 'assistant') {
            avatarIcon = '<i class="fas fa-robot"></i>';
        } else if (type === 'error') {
            avatarIcon = '<i class="fas fa-exclamation-triangle"></i>';
        }
        
        messageEl.innerHTML = `
            <div class="message-avatar">${avatarIcon}</div>
            <div class="message-content">
                <div class="message-text">${this.escapeHtml(content)}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
        
        this.chatMessages.appendChild(messageEl);
        this.scrollToBottom();
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});

// Add some utility functions
window.addEventListener('online', () => {
    console.log('Network connection restored');
});

window.addEventListener('offline', () => {
    console.log('Network connection lost');
});

// Prevent accidental page refresh during active conversation
window.addEventListener('beforeunload', (e) => {
    const messageCount = document.querySelectorAll('.message').length;
    if (messageCount > 2) { // More than just welcome message
        e.preventDefault();
        e.returnValue = '';
    }
});