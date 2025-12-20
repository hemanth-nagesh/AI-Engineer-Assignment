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
        this.logLevels = {
            'INFO': { color: '#06b6d4', icon: 'fa-info-circle' },
            'ERROR': { color: '#ef4444', icon: 'fa-exclamation-triangle' },
            'WARNING': { color: '#f59e0b', icon: 'fa-exclamation-circle' },
            'SUCCESS': { color: '#10b981', icon: 'fa-check-circle' }
        };
        
        this.initializeElements();
        this.bindEvents();
        this.loadCachedMessages();
        this.connect();
        this.startConnectionTimer();
        this.initializeAnimations();
    }

    generateClientId() {
        return 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    initializeAnimations() {
        // Add smooth scroll behavior
        document.documentElement.style.scrollBehavior = 'smooth';
        
        // Add entrance animations
        this.addEntranceAnimations();
    }

    addEntranceAnimations() {
        const elements = document.querySelectorAll('.chat-section, .logs-section');
        elements.forEach((el, index) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            setTimeout(() => {
                el.style.transition = 'all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }, index * 200);
        });
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
        
        this.showLoading(true);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => this.onConnectionOpen();
            this.ws.onmessage = (event) => this.onMessage(event);
            this.ws.onclose = () => this.onConnectionClose();
            this.ws.onerror = (error) => this.onConnectionError(error);
            
        } catch (error) {
            this.showError('Failed to connect to Agentic AI Demo server');
            this.showLoading(false);
        }
    }

    onConnectionOpen() {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.connectionStartTime = Date.now();
        
        this.updateConnectionStatus(true);
        this.showLoading(false);
        this.addLog('✅ Connected to Agentic AI Demo', 'SUCCESS');
        
        // Start ping interval for connection health
        this.startPingInterval();
        
        // Add celebration animation
        this.celebrateConnection();
    }

    celebrateConnection() {
        const statusIndicator = document.getElementById('status-indicator');
        statusIndicator.style.animation = 'none';
        setTimeout(() => {
            statusIndicator.style.animation = 'pulse 1s ease-in-out 3';
        }, 100);
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
                    // Show all logs except the most verbose ones
                    if (!data.message.includes('Response delivered to client_')) {
                        this.addLog(data.message, data.level, data.timestamp);
                    }
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
            }
        } catch (error) {
            // Don't log parsing errors to UI
        }
    }

    onConnectionClose() {
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.addLog('🔌 Disconnected from Agentic AI Demo server', 'WARNING');
        this.hideTypingIndicator();
        
        // Clear ping interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        
        // Attempt to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            this.addLog(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, 'INFO');
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            this.addLog('❌ Max reconnection attempts reached', 'ERROR');
            this.showError('Connection lost. Please refresh the page to reconnect to Agentic AI Demo.');
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
            this.showError('Not connected to Agentic AI Demo server');
            return;
        }
        
        // Add user message to chat
        this.addMessage(message, 'user');
        this.messageCount++;
        this.updateMessageCount();
        
        // Clear input with animation
        this.animateInputClear();
        
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
            this.showError('Failed to send message to AI Agent');
        }
    }

    animateInputClear() {
        this.messageInput.style.transform = 'scale(0.98)';
        this.messageInput.value = '';
        this.updateCharCount();
        setTimeout(() => {
            this.messageInput.style.transform = 'scale(1)';
        }, 150);
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
        const logConfig = this.logLevels[level] || this.logLevels['INFO'];
        
        logEl.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-level ${level}" style="color: ${logConfig.color}; border-color: ${logConfig.color};">
                <i class="fas ${logConfig.icon}" style="margin-right: 4px;"></i>${level}
            </span>
            <span class="log-message">${this.escapeHtml(message)}</span>
        `;
        
        this.logsContainer.appendChild(logEl);
        
        // Highlight important logs
        if (level === 'ERROR' || level === 'SUCCESS') {
            this.highlightLog(logEl, level);
        }
        
        // Keep only last 100 logs
        const logs = this.logsContainer.querySelectorAll('.log-entry');
        if (logs.length > 100) {
            logs[0].remove();
        }
        
        // Auto-scroll to bottom with smooth animation
        this.smoothScrollToBottom(this.logsContainer);
    }

    highlightLog(logEl, level) {
        const bgColor = level === 'ERROR' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';
        logEl.style.backgroundColor = bgColor;
        logEl.style.borderLeft = `3px solid ${level === 'ERROR' ? '#ef4444' : '#10b981'}`;
        
        setTimeout(() => {
            logEl.style.transition = 'background-color 2s ease';
            logEl.style.backgroundColor = '';
        }, 2000);
    }

    smoothScrollToBottom(element) {
        const start = element.scrollTop;
        const end = element.scrollHeight - element.clientHeight;
        const duration = 300;
        const startTime = performance.now();
        
        const animateScroll = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic
            
            element.scrollTop = start + (end - start) * easeProgress;
            
            if (progress < 1) {
                requestAnimationFrame(animateScroll);
            }
        };
        
        requestAnimationFrame(animateScroll);
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
        // Add fade out animation to existing messages
        const messages = this.chatMessages.querySelectorAll('.message');
        messages.forEach((msg, index) => {
            setTimeout(() => {
                msg.style.transition = 'all 0.3s ease';
                msg.style.opacity = '0';
                msg.style.transform = 'translateX(-20px)';
            }, index * 50);
        });
        
        // Clear and show welcome message after animation
        setTimeout(() => {
            this.chatMessages.innerHTML = `
                <div class="welcome-message">
                    <i class="fas fa-rocket"></i>
                    <h3>Chat Cleared!</h3>
                    <p>Ready for a new conversation with AI Agent...</p>
                </div>
            `;
            this.messageCount = 0;
            this.updateMessageCount();
            
            // Clear the cache when chat is cleared
            this.clearMessageCache();
            this.addLog('🗑️ Chat history cleared', 'INFO');
        }, messages.length * 50 + 300);
    }

    // Removed toggleLogs functionality - logs section now always visible

    clearLogs() {
        // Add fade out animation
        const logs = this.logsContainer.querySelectorAll('.log-entry');
        logs.forEach((log, index) => {
            setTimeout(() => {
                log.style.transition = 'all 0.2s ease';
                log.style.opacity = '0';
                log.style.transform = 'translateX(-10px)';
            }, index * 20);
        });
        
        // Clear and show cleared message
        setTimeout(() => {
            this.logsContainer.innerHTML = `
                <div class="log-entry info">
                    <span class="log-time">System</span>
                    <span class="log-level">INFO</span>
                    <span class="log-message">🧹 Logs cleared</span>
                </div>
            `;
        }, logs.length * 20 + 200);
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
        
        // Add shake animation to error modal
        this.errorModal.style.animation = 'none';
        setTimeout(() => {
            this.errorModal.style.animation = 'shake 0.5s ease-in-out';
        }, 100);
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
            welcomeMessage.style.transition = 'all 0.3s ease';
            welcomeMessage.style.opacity = '0';
            welcomeMessage.style.transform = 'scale(0.9)';
            setTimeout(() => welcomeMessage.remove(), 300);
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
        this.smoothScrollToBottom(this.chatMessages);
        
        // Add typing effect for AI messages
        if (type === 'assistant') {
            this.addTypingEffect(messageEl.querySelector('.message-text'));
        }
    }

    addTypingEffect(element) {
        const text = element.textContent;
        element.textContent = '';
        element.style.opacity = '1';
        
        let index = 0;
        const typeChar = () => {
            if (index < text.length) {
                element.textContent += text[index];
                index++;
                setTimeout(typeChar, 20); // Adjust typing speed here
            }
        };
        
        setTimeout(typeChar, 300); // Start typing after a short delay
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
        e.returnValue = 'Are you sure you want to leave the Agentic AI Demo?';
    }
});

// Add CSS animation for shake effect
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
`;
document.head.appendChild(style);