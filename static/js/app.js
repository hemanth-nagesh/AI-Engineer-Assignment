// Enhanced ChatApp class with improved browser-side caching
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
        
        // Enhanced caching properties
        this.messageCache = [];
        this.cacheKey = 'agenticAI_chatMessages';
        this.metadataKey = 'agenticAI_metadata';
        this.maxCacheSize = 500; // Maximum messages to cache
        
        this.initializeElements();
        this.bindEvents();
        this.loadCachedData();
        this.connect();
        this.startConnectionTimer();
        this.initializeAnimations();
        this.startAutoSave();
    }

    generateClientId() {
        // Check if we have a persistent client ID
        let clientId = localStorage.getItem('agenticAI_clientId');
        if (!clientId) {
            clientId = 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            localStorage.setItem('agenticAI_clientId', clientId);
        }
        return clientId;
    }

    initializeAnimations() {
        document.documentElement.style.scrollBehavior = 'smooth';
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
        // this.toggleLogsBtn = document.getElementById('toggle-logs');
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
        // this.toggleLogsBtn.addEventListener('click', () => this.toggleLogs());
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
            this.saveCacheToStorage();
            if (this.ws) {
                this.ws.close();
            }
        });

        // Save on visibility change (tab switch)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.saveCacheToStorage();
            }
        });
    }

    // ==================== ENHANCED CACHING SYSTEM ====================
    
    startAutoSave() {
        // Auto-save every 10 seconds
        this.autoSaveInterval = setInterval(() => {
            this.saveCacheToStorage();
        }, 10000);
    }

    loadCachedData() {
        try {
            console.log('📦 Loading cached data from browser storage...');
            
            // Load messages from cache
            const cachedMessages = localStorage.getItem(this.cacheKey);
            const cachedMetadata = localStorage.getItem(this.metadataKey);
            
            if (cachedMessages) {
                this.messageCache = JSON.parse(cachedMessages);
                console.log(`✅ Loaded ${this.messageCache.length} cached messages`);
                
                // Remove welcome message if we have cached messages
                if (this.messageCache.length > 0) {
                    const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
                    if (welcomeMessage) {
                        welcomeMessage.remove();
                    }
                }
                
                // Render cached messages to DOM
                this.messageCache.forEach(msg => {
                    this.addMessageToDOM(msg.content, msg.type, msg.timestamp, false);
                });
                
                // Load metadata
                if (cachedMetadata) {
                    const metadata = JSON.parse(cachedMetadata);
                    this.messageCount = metadata.messageCount || 0;
                    this.updateMessageCount();
                    console.log(`📊 Message count restored: ${this.messageCount}`);
                }
                
                this.addLog(`✅ Restored ${this.messageCache.length} messages from cache`, 'SUCCESS');
            } else {
                console.log('ℹ️ No cached messages found');
            }
        } catch (error) {
            console.error('❌ Error loading cached data:', error);
            this.addLog('⚠️ Could not restore previous messages', 'WARNING');
            this.messageCache = [];
        }
    }

    saveCacheToStorage() {
        try {
            // Trim cache if it exceeds max size
            if (this.messageCache.length > this.maxCacheSize) {
                this.messageCache = this.messageCache.slice(-this.maxCacheSize);
                console.log(`🗜️ Cache trimmed to ${this.maxCacheSize} messages`);
            }
            
            // Save messages
            localStorage.setItem(this.cacheKey, JSON.stringify(this.messageCache));
            
            // Save metadata
            const metadata = {
                messageCount: this.messageCount,
                lastSaved: new Date().toISOString(),
                clientId: this.clientId
            };
            localStorage.setItem(this.metadataKey, JSON.stringify(metadata));
            
            console.log(`💾 Saved ${this.messageCache.length} messages to cache`);
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.warn('⚠️ Storage quota exceeded, clearing old messages...');
                // Remove oldest half of messages
                this.messageCache = this.messageCache.slice(Math.floor(this.messageCache.length / 2));
                this.saveCacheToStorage(); // Try again
            } else {
                console.error('❌ Error saving cache:', error);
            }
        }
    }

    addToCache(content, type, timestamp) {
        const messageObj = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            content: content,
            type: type,
            timestamp: timestamp,
            savedAt: new Date().toISOString()
        };
        
        this.messageCache.push(messageObj);
        
        // Immediate save for important messages
        if (type === 'assistant' || type === 'error') {
            this.saveCacheToStorage();
        }
    }

    clearMessageCache() {
        try {
            console.log('🗑️ Clearing message cache...');
            this.messageCache = [];
            localStorage.removeItem(this.cacheKey);
            localStorage.removeItem(this.metadataKey);
            console.log('✅ Message cache cleared successfully');
            this.addLog('🗑️ Chat history cleared from storage', 'INFO');
        } catch (error) {
            console.error('❌ Error clearing message cache:', error);
        }
    }

    exportChatHistory() {
        try {
            const exportData = {
                clientId: this.clientId,
                exportDate: new Date().toISOString(),
                messageCount: this.messageCache.length,
                messages: this.messageCache
            };
            
            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `agentic-ai-chat-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            
            URL.revokeObjectURL(url);
            this.addLog('📥 Chat history exported successfully', 'SUCCESS');
        } catch (error) {
            console.error('❌ Error exporting chat history:', error);
            this.showError('Failed to export chat history');
        }
    }

    getCacheStats() {
        const cacheSize = new Blob([localStorage.getItem(this.cacheKey) || '']).size;
        const cacheSizeKB = (cacheSize / 1024).toFixed(2);
        
        return {
            messageCount: this.messageCache.length,
            cacheSize: cacheSizeKB + ' KB',
            maxSize: this.maxCacheSize,
            utilization: ((this.messageCache.length / this.maxCacheSize) * 100).toFixed(1) + '%'
        };
    }

    // ==================== CONNECTION MANAGEMENT ====================

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws/${this.clientId}`;
        
        console.log('🔌 Attempting to connect to:', wsUrl);
        this.addLog(`🔌 Connecting to: ${wsUrl}`, 'INFO');
        
        this.showLoading(true);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => this.onConnectionOpen();
            this.ws.onmessage = (event) => this.onMessage(event);
            this.ws.onclose = (event) => this.onConnectionClose(event);
            this.ws.onerror = (error) => this.onConnectionError(error);
            
        } catch (error) {
            console.error('❌ WebSocket connection error:', error);
            this.showError('Failed to connect to Agentic AI Demo server: ' + error.message);
            this.showLoading(false);
            this.addLog('❌ Connection failed: ' + error.message, 'ERROR');
        }
    }

    onConnectionOpen() {
        console.log('✅ WebSocket connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.connectionStartTime = Date.now();
        
        this.updateConnectionStatus(true);
        this.showLoading(false);
        this.addLog('✅ Connected to Agentic AI Demo', 'SUCCESS');
        
        this.startPingInterval();
        this.celebrateConnection();
    }

    celebrateConnection() {
        const statusIndicator = document.getElementById('status-indicator');
        if (statusIndicator) {
            statusIndicator.style.animation = 'none';
            setTimeout(() => {
                statusIndicator.style.animation = 'pulse 1s ease-in-out 3';
            }, 100);
        }
    }

    onMessage(event) {
        try {
            console.log('📨 Received message:', event.data);
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'response':
                    console.log('🤖 AI Response:', data.content);
                    this.addMessage(data.content, 'assistant', data.timestamp);
                    this.hideTypingIndicator();
                    break;
                    
                case 'log':
                    if (!data.message.includes('Response delivered to client_')) {
                        this.addLog(data.message, data.level, data.timestamp);
                    }
                    break;
                    
                case 'typing':
                    this.handleTypingIndicator(data.client_id, data.is_typing);
                    break;
                    
                case 'error':
                    console.error('❌ Server error:', data.content);
                    this.addMessage(data.content, 'error', data.timestamp);
                    this.hideTypingIndicator();
                    this.addLog('❌ Server error: ' + data.content, 'ERROR');
                    break;
                    
                case 'pong':
                    console.log('🏓 Pong received');
                    break;
                    
                default:
                    console.warn('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('❌ Error parsing message:', error, 'Raw data:', event.data);
        }
    }

    onConnectionClose(event) {
        console.log('🔌 WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.updateConnectionStatus(false);
        this.addLog(`🔌 Disconnected from server (Code: ${event.code})`, 'WARNING');
        this.hideTypingIndicator();
        
        // Save before attempting reconnect
        this.saveCacheToStorage();
        
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            console.log(`🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
            this.addLog(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, 'INFO');
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            console.error('❌ Max reconnection attempts reached');
            this.addLog('❌ Max reconnection attempts reached', 'ERROR');
            this.showError('Connection lost. Please refresh the page to reconnect to Agentic AI Demo.');
        }
    }

    onConnectionError(error) {
        console.error('❌ WebSocket error:', error);
        this.addLog(`❌ WebSocket error: ${error.message || 'Unknown error'}`, 'ERROR');
        this.updateConnectionStatus(false);
    }

    // ==================== MESSAGE HANDLING ====================

    sendMessage() {
        const message = this.messageInput.value.trim();
        
        if (!message) {
            console.warn('⚠️ Empty message, not sending');
            return;
        }
        
        if (!this.isConnected) {
            console.error('❌ Not connected to server');
            this.showError('Not connected to Agentic AI Demo server');
            return;
        }
        
        if (this.ws.readyState !== WebSocket.OPEN) {
            console.error('❌ WebSocket not ready:', this.ws.readyState);
            this.showError('Connection not ready. Please wait...');
            return;
        }
        
        console.log('📤 Sending message:', message);
        
        this.addMessage(message, 'user');
        this.messageCount++;
        this.updateMessageCount();
        
        this.animateInputClear();
        
        const messageData = {
            type: 'message',
            content: message,
            client_id: this.clientId,
            timestamp: new Date().toISOString()
        };
        
        try {
            this.ws.send(JSON.stringify(messageData));
            console.log('✅ Message sent successfully');
            this.showTypingIndicator();
            this.addLog('📤 Message sent to AI agent', 'INFO');
        } catch (error) {
            console.error('❌ Failed to send message:', error);
            this.showError('Failed to send message: ' + error.message);
            this.addLog('❌ Failed to send message: ' + error.message, 'ERROR');
        }
    }

    addMessage(content, type, timestamp = null) {
        const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        
        // Add to cache
        this.addToCache(content, type, time);
        
        // Add to DOM
        this.addMessageToDOM(content, type, time, true);
    }

    addMessageToDOM(content, type, timestamp = null, animate = true) {
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
        
        if (animate && type === 'assistant') {
            this.addTypingEffect(messageEl.querySelector('.message-text'));
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

    // ==================== UI HELPERS ====================

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
        
        if (level === 'ERROR' || level === 'SUCCESS') {
            this.highlightLog(logEl, level);
        }
        
        const logs = this.logsContainer.querySelectorAll('.log-entry');
        if (logs.length > 100) {
            logs[0].remove();
        }
        
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
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            
            element.scrollTop = start + (end - start) * easeProgress;
            
            if (progress < 1) {
                requestAnimationFrame(animateScroll);
            }
        };
        
        requestAnimationFrame(animateScroll);
    }

    handleTypingIndicator(clientId, isTyping) {
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
                console.log('🏓 Ping sent');
            }
        }, 30000);
    }

    clearChat() {
        const messages = this.chatMessages.querySelectorAll('.message');
        messages.forEach((msg, index) => {
            setTimeout(() => {
                msg.style.transition = 'all 0.3s ease';
                msg.style.opacity = '0';
                msg.style.transform = 'translateX(-20px)';
            }, index * 50);
        });
        
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
            this.clearMessageCache();
            this.addLog('🗑️ Chat history cleared', 'INFO');
        }, messages.length * 50 + 300);
    }

    // toggleLogs() {
    //     const logsSection = document.querySelector('.logs-section');
    //     logsSection.classList.toggle('hidden');
        
    //     const icon = this.toggleLogsBtn.querySelector('i');
    //     if (logsSection.classList.contains('hidden')) {
    //         icon.className = 'fas fa-eye-slash';
    //     } else {
    //         icon.className = 'fas fa-eye';
    //     }
    // }

    clearLogs() {
        const logs = this.logsContainer.querySelectorAll('.log-entry');
        logs.forEach((log, index) => {
            setTimeout(() => {
                log.style.transition = 'all 0.2s ease';
                log.style.opacity = '0';
                log.style.transform = 'translateX(-10px)';
            }, index * 20);
        });
        
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
        if (this.loadingOverlay) {
            if (show) {
                this.loadingOverlay.classList.remove('hidden');
            } else {
                this.loadingOverlay.classList.add('hidden');
            }
        }
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorModal.classList.add('active');
        
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

    addTypingEffect(element) {
        const text = element.textContent;
        element.textContent = '';
        element.style.opacity = '1';
        
        let index = 0;
        const typeChar = () => {
            if (index < text.length) {
                element.textContent += text[index];
                index++;
                setTimeout(typeChar, 5);
            }
        };
        
        setTimeout(typeChar, 100);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Agentic AI Demo...');
    window.chatApp = new ChatApp();
    
    // Add cache stats to console
    console.log('💾 Cache Statistics:', window.chatApp.getCacheStats());
    
    // Expose export function globally
    window.exportChatHistory = () => window.chatApp.exportChatHistory();
});

// Add keyboard shortcut for export (Ctrl+Shift+E)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        if (window.chatApp) {
            window.chatApp.exportChatHistory();
        }
    }
});

window.addEventListener('online', () => {
    console.log('🌐 Network connection restored');
});

window.addEventListener('offline', () => {
    console.log('📡 Network connection lost');
});

const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
`;
document.head.appendChild(style);