class MaxLLMChatbot {
    constructor() {
        this.apiKey = typeof window !== 'undefined' ? (window.MAXLLM_API_KEY || null) : null;
        this.currentModel = 'deepseek/deepseek-r1:free';
        this.chatHistory = [];
        this.isLoading = false;
        this.db = null;
        this.sessionId = localStorage.getItem('maxllm_session_id') || this.startNewSession();
        
        this.initializeElements();
        this.loadFromDatabase();
        this.setupEventListeners();
        this.initDatabase();
    }

    initializeElements() {
        this.elements = {
            chatMessages: document.getElementById('chatMessages'),
            messageInput: document.getElementById('messageInput'),
            sendButton: document.getElementById('sendButton'),
            modelSelect: document.getElementById('modelSelect'),
            loading: document.getElementById('loading'),
            clearChat: document.getElementById('clearChat'),
            exportChat: document.getElementById('exportChat'),
            openHistory: document.getElementById('openHistory'),
            historyBackdrop: document.getElementById('historyBackdrop'),
            closeHistory: document.getElementById('closeHistory'),
            historyContent: document.getElementById('historyContent')
        };
    }

    setupEventListeners() {
        // Send message events
        this.elements.sendButton.addEventListener('click', () => this.sendMessage());
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Model selection
        this.elements.modelSelect.addEventListener('change', (e) => {
            this.currentModel = e.target.value;
            this.saveToDatabase();
        });

        // Clear chat
        this.elements.clearChat.addEventListener('click', () => this.clearChat());

        // Export chat
        this.elements.exportChat.addEventListener('click', () => this.exportChat());

        // Auto-resize textarea
        this.elements.messageInput.addEventListener('input', () => this.autoResizeTextarea());

        // History open/close
        if (this.elements.openHistory) {
            this.elements.openHistory.addEventListener('click', () => this.showHistory());
        }
        if (this.elements.closeHistory) {
            this.elements.closeHistory.addEventListener('click', () => this.hideHistory());
        }
        if (this.elements.historyBackdrop) {
            this.elements.historyBackdrop.addEventListener('click', (e) => {
                if (e.target === this.elements.historyBackdrop) this.hideHistory();
            });
        }
    }


    autoResizeTextarea() {
        const textarea = this.elements.messageInput;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    async sendMessage() {
        const message = this.elements.messageInput.value.trim();
        if (!message || this.isLoading || !this.apiKey) return;

        // Build messages and enforce a ~1000 token window
        const messages = this.buildMessages(message);
        const tokenCount = this.estimateTokens(messages);
        if (tokenCount > 1000) {
            this.addMessage('error', 'CLEAR CHAT');
            return;
        }

        // Add user message
        this.addMessage('user', message);
        this.elements.messageInput.value = '';
        this.autoResizeTextarea();

        // Show loading
        this.setLoading(true);

        try {
            const response = await this.callOpenRouterAPI(messages);
            this.addMessage('assistant', response);
        } catch (error) {
            this.addMessage('error', `Error: ${error.message}`);
        }

        this.setLoading(false);
        this.saveToDatabase();
    }

    async callOpenRouterAPI(messages) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'maxLLM Chatbot'
            },
            body: JSON.stringify({
                model: this.currentModel,
                messages: messages,
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'API request failed');
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    buildMessages(userContent) {
        return [
            { role: 'system', content: 'You are maxLLM, a helpful and friendly AI assistant.' },
            ...this.chatHistory.slice(-10),
            { role: 'user', content: userContent }
        ];
    }

    estimateTokens(messages) {
        // Rough heuristic: ~4 characters per token
        try {
            const totalChars = messages.reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
            return Math.ceil(totalChars / 4);
        } catch (_) {
            return 0;
        }
    }

    addMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        messageDiv.textContent = content;
        
        this.elements.chatMessages.appendChild(messageDiv);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;

        // Add to chat history (exclude error messages)
        if (role !== 'error') {
            this.chatHistory.push({ role, content });
            this.addRecordToDb(role, content);
        }
    }

    setLoading(loading) {
        this.isLoading = loading;
        this.elements.loading.style.display = loading ? 'block' : 'none';
        this.elements.sendButton.disabled = loading;
    }

    clearChat() {
        this.elements.chatMessages.innerHTML = '';
        this.chatHistory = [];
        this.saveToDatabase();
        this.startNewSession(true);
    }

    exportChat() {
        const chatData = {
            timestamp: new Date().toISOString(),
            model: this.currentModel,
            messages: this.chatHistory
        };

        const blob = new Blob([JSON.stringify(chatData, null, 2)], {
            type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `maxllm-chat-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    saveToDatabase() {
        const data = {
            chatHistory: this.chatHistory,
            currentModel: this.currentModel,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('maxllm_data', JSON.stringify(data));
    }

    loadFromDatabase() {
        const saved = localStorage.getItem('maxllm_data');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.chatHistory = data.chatHistory || [];
                this.currentModel = data.currentModel || 'deepseek/deepseek-r1:free';
                this.elements.modelSelect.value = this.currentModel;

                // Restore chat messages
                this.chatHistory.forEach(msg => {
                    this.addMessageToUI(msg.role, msg.content);
                });
            } catch (error) {
                console.error('Error loading saved data:', error);
            }
        }
    }

    addMessageToUI(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        messageDiv.textContent = content;
        this.elements.chatMessages.appendChild(messageDiv);
    }

    // --- Small IndexedDB for conversation records ---
    initDatabase() {
        if (!('indexedDB' in window)) return;
        const request = indexedDB.open('maxllm_db', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('chat_records')) {
                const store = db.createObjectStore('chat_records', { keyPath: 'id', autoIncrement: true });
                store.createIndex('sessionId', 'sessionId', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            this.db = event.target.result;
        };

        request.onerror = () => {
            console.warn('IndexedDB init failed; records will not be persisted.');
        };
    }

    addRecordToDb(role, content) {
        if (!this.db) return;
        try {
            const tx = this.db.transaction('chat_records', 'readwrite');
            const store = tx.objectStore('chat_records');
            store.add({
                sessionId: this.sessionId,
                timestamp: Date.now(),
                role,
                content,
                model: this.currentModel
            });
        } catch (_) {
            // ignore
        }
    }

    startNewSession(force = false) {
        const newId = `session-${Date.now()}`;
        if (force || !this.sessionId) {
            this.sessionId = newId;
            localStorage.setItem('maxllm_session_id', this.sessionId);
        }
        return this.sessionId;
    }

    async showHistory() {
        if (!this.db) {
            alert('History unavailable (database not initialized).');
            return;
        }
        const sessions = await this.readAllSessions();
        this.renderHistory(sessions);
        if (this.elements.historyBackdrop) this.elements.historyBackdrop.style.display = 'flex';
    }

    hideHistory() {
        if (this.elements.historyBackdrop) this.elements.historyBackdrop.style.display = 'none';
    }

    readAllSessions() {
        return new Promise((resolve) => {
            const result = new Map();
            const tx = this.db.transaction('chat_records', 'readonly');
            const store = tx.objectStore('chat_records');
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const rec = cursor.value;
                    if (!result.has(rec.sessionId)) result.set(rec.sessionId, []);
                    result.get(rec.sessionId).push(rec);
                    cursor.continue();
                } else {
                    const sessions = Array.from(result.entries()).map(([id, records]) => ({
                        sessionId: id,
                        records: records.sort((a,b) => a.timestamp - b.timestamp)
                    })).sort((a,b) => b.records[0]?.timestamp - a.records[0]?.timestamp);
                    resolve(sessions);
                }
            };
            cursorReq.onerror = () => resolve([]);
        });
    }

    renderHistory(sessions) {
        if (!this.elements.historyContent) return;
        if (!sessions.length) {
            this.elements.historyContent.innerHTML = '<div class="history-session">No records yet.</div>';
            return;
        }
        const html = sessions.map(s => {
            const titleTime = new Date(s.records[0].timestamp).toLocaleString();
            const items = s.records.map(r => `
                <div class="history-message">
                    <div class="history-role">${r.role}</div>
                    <div class="history-text">${this.escapeHtml(String(r.content || ''))}</div>
                    <div class="history-time">${new Date(r.timestamp).toLocaleString()}</div>
                </div>
            `).join('');
            return `
                <div class="history-session">
                    <h4>${s.sessionId} — ${titleTime}</h4>
                    ${items}
                </div>
            `;
        }).join('');
        this.elements.historyContent.innerHTML = html;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the chatbot when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new MaxLLMChatbot();
});
