// Função para inicializar a aplicação com verificação de dependências
function initApp() {
    // Verificar se todas as dependências estão carregadas
    const checkDependencies = () => {
        return typeof fetch !== 'undefined'; // fetch é nativo nos browsers modernos
    };

    if (!checkDependencies()) {
        console.error('Dependências não carregadas, tentando novamente...');
        setTimeout(initApp, 500);
        return;
    }

    class WhisperTranscriber {
        constructor() {
            this.files = [];
            this.processedFiles = [];
            this.refreshInterval = null;
            this.modalInstance = null;
            this.isRefreshing = false;
            // Adiciona um Set para rastrear transcrições já solicitadas
            this.transcriptionRequests = new Set();
            this.initializeElements();
            this.bindEvents();
            this.loadProcessedFiles();
            this.startAutoRefresh();
        }

        initializeElements() {
            this.dropZone = document.getElementById('dropZone');
            this.fileInput = document.getElementById('fileInput');
            this.browseBtn = document.getElementById('browseBtn');
            this.submitBtn = document.getElementById('submitBtn');
            this.form = document.getElementById('uploadForm');
            this.fileList = document.getElementById('fileList');
            this.filesContainer = document.getElementById('filesContainer');
            this.clearFiles = document.getElementById('clearFiles');
            this.loading = document.getElementById('loading');
            this.refreshFiles = document.getElementById('refreshFiles');
            this.filesTableContainer = document.getElementById('filesTableContainer');
            
            // Modal elements (serão inicializados quando necessário)
            this.modalLoading = document.getElementById('modalLoading');
            this.transcriptionContent = document.getElementById('transcriptionContent');
            this.modalTranscriptionText = document.getElementById('modalTranscriptionText');
            this.modalFileInfo = document.getElementById('modalFileInfo');
            this.copyModalText = document.getElementById('copyModalText');
            this.downloadTranscription = document.getElementById('downloadTranscription');
        }

        // Inicializar modal quando necessário
        getModalInstance() {
            if (!this.modalInstance && typeof bootstrap !== 'undefined') {
                const modalElement = document.getElementById('transcriptionModal');
                if (modalElement) {
                    this.modalInstance = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement);
                }
            }
            return this.modalInstance;
        }

        bindEvents() {
            // Browse button click
            if (this.browseBtn) {
                this.browseBtn.addEventListener('click', () => {
                    if (this.fileInput) {
                        this.fileInput.click();
                    }
                });
            }

            // File input change (agora com multiple)
            if (this.fileInput) {
                this.fileInput.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        this.addFiles(Array.from(e.target.files));
                    }
                });
            }

            // Drop zone events
            if (this.dropZone) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                    this.dropZone.addEventListener(eventName, this.preventDefaults, false);
                });

                ['dragenter', 'dragover'].forEach(eventName => {
                    this.dropZone.addEventListener(eventName, () => {
                        this.dropZone.classList.add('dragover');
                    }, false);
                });

                ['dragleave', 'drop'].forEach(eventName => {
                    this.dropZone.addEventListener(eventName, () => {
                        this.dropZone.classList.remove('dragover');
                    }, false);
                });

                // Handle dropped files
                this.dropZone.addEventListener('drop', (e) => {
                    const dt = e.dataTransfer;
                    const files = dt.files;
                    if (files.length > 0) {
                        this.addFiles(Array.from(files));
                    }
                }, false);
            }

            // Clear files
            if (this.clearFiles) {
                this.clearFiles.addEventListener('click', () => {
                    this.clearAllFiles();
                });
            }

            // Form submit
            if (this.form) {
                this.form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    if (this.files.length > 0) {
                        this.uploadFiles();
                    }
                });
            }

            // Refresh files
            if (this.refreshFiles) {
                this.refreshFiles.addEventListener('click', () => {
                    this.loadProcessedFiles();
                });
            }

            // Copy text from modal (delegated event)
            document.addEventListener('click', (e) => {
                if (e.target.closest('#copyModalText')) {
                    this.copyModalToClipboard();
                }
            });
        }

        preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        addFiles(newFiles) {
            // Adicionar novos arquivos à lista existente
            newFiles.forEach(file => {
                if (file.type.startsWith('audio/')) {
                    // Verificar se o arquivo já não está na lista
                    const exists = this.files.some(f => f.name === file.name && f.size === file.size);
                    if (!exists) {
                        this.files.push(file);
                    }
                }
            });
            
            this.updateFileList();
        }

        updateFileList() {
            if (this.fileList && this.filesContainer && this.submitBtn) {
                if (this.files.length > 0) {
                    this.fileList.classList.remove('d-none');
                    this.submitBtn.disabled = false;
                    
                    // Limpar container
                    this.filesContainer.innerHTML = '';
                    
                    // Adicionar cada arquivo
                    this.files.forEach((file, index) => {
                        const fileElement = document.createElement('div');
                        fileElement.className = 'd-flex justify-content-between align-items-center bg-white p-2 mb-2 rounded border';
                        fileElement.innerHTML = `
                            <div>
                                <i class="bi bi-file-earmark-music"></i>
                                <span>${this.escapeHtml(file.name)}</span>
                                <small class="text-muted">(${(file.size/1024/1024).toFixed(2)} MB)</small>
                            </div>
                            <button type="button" class="btn btn-sm btn-outline-danger remove-file" data-index="${index}">
                                <i class="bi bi-x"></i>
                            </button>
                        `;
                        this.filesContainer.appendChild(fileElement);
                    });
                    
                    // Adicionar eventos para remover arquivos individuais usando event delegation
                    this.filesContainer.addEventListener('click', (e) => {
                        if (e.target.closest('.remove-file')) {
                            const button = e.target.closest('.remove-file');
                            const index = parseInt(button.getAttribute('data-index'));
                            this.removeFile(index);
                        }
                    });
                } else {
                    this.fileList.classList.add('d-none');
                    this.submitBtn.disabled = true;
                }
            }
        }

        removeFile(index) {
            this.files.splice(index, 1);
            this.updateFileList();
        }

        clearAllFiles() {
            this.files = [];
            this.updateFileList();
        }

        async uploadFiles() {
            if (!this.loading || !this.submitBtn) return;
            
            const formData = new FormData();
            this.files.forEach(file => {
                formData.append('files', file);
            });

            // Show loading
            this.loading.style.display = 'block';
            this.submitBtn.disabled = true;
            this.submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';

            try {
                const response = await fetch('./api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                console.log('Upload response:', data);
                
                // Limpar lista de arquivos selecionados
                this.clearAllFiles();
                
                // Atualizar lista de arquivos processados
                setTimeout(() => {
                    this.loadProcessedFiles();
                }, 1000);
                
                if (alert) {
                    alert(`${data.files.length} arquivos enviados com sucesso!`);
                }
                
            } catch (error) {
                console.error('Error:', error);
                if (alert) {
                    alert('Erro ao enviar os arquivos. Por favor, tente novamente.');
                }
            } finally {
                // Hide loading
                this.loading.style.display = 'none';
                if (this.submitBtn) {
                    this.submitBtn.disabled = false;
                    this.submitBtn.innerHTML = '<i class="bi bi-upload me-2"></i>Enviar Arquivos';
                }
            }
        }

        startAutoRefresh() {
            // Auto-refresh a cada 5 segundos para melhor experiência em tempo real
            this.refreshInterval = setInterval(() => {
                this.loadProcessedFiles();
            }, 5000);
        }

        async loadProcessedFiles() {
            // Evitar múltiplas requisições simultâneas
            if (this.isRefreshing || !this.filesTableContainer) {
                return;
            }
            
            this.isRefreshing = true;
            
            try {
                const response = await fetch('./api/files');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                this.processedFiles = data.files || [];
                this.renderFilesTable();
            } catch (error) {
                console.error('Error loading files:', error);
                // Não mostrar erro na interface para não incomodar o usuário
            } finally {
                this.isRefreshing = false;
            }
        }

        renderFilesTable() {
            if (!this.filesTableContainer) return;
            
            if (this.processedFiles.length === 0) {
                this.filesTableContainer.innerHTML = `
                    <div class="text-center text-muted">
                        <i class="bi bi-inbox"></i>
                        <p class="mb-0">Nenhum arquivo processado ainda</p>
                    </div>
                `;
                return;
            }

            let tableHtml = `
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead>
                            <tr>
                                <th>Nome do Arquivo</th>
                                <th>Status</th>
                                <th>Detalhes</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            // Ordenar arquivos: processing primeiro, depois completed, depois error, depois uploaded
            const sortedFiles = [...this.processedFiles].sort((a, b) => {
                const statusOrder = {
                    'processing': 1,
                    'completed': 2,
                    'error': 3,
                    'uploaded': 4,
                    'unknown': 5
                };
                
                const statusA = a.status || (a.type === 'input' ? 'uploaded' : 'unknown');
                const statusB = b.status || (b.type === 'input' ? 'uploaded' : 'unknown');
                
                return statusOrder[statusA] - statusOrder[statusB];
            });

            sortedFiles.forEach(file => {
                let statusBadge = '';
                let actions = '';
                let details = '';
                
                if (file.type === 'input') {
                    // Arquivo de áudio ainda não processado
                    statusBadge = '<span class="badge bg-info">Aguardando</span>';
                    actions = `
                        <button class="btn btn-sm btn-primary transcribe-btn" data-filename="${this.escapeHtml(file.filename)}">
                            <i class="bi bi-translate"></i> Transcrever
                        </button>
                    `;
                    details = `<small class="text-muted">${(file.size/1024/1024).toFixed(2)} MB</small>`;
                } else if (file.type === 'processed') {
                    // Arquivo processado
                    const status = file.status || 'unknown';
                    
                    if (status === 'processing') {
                        statusBadge = '<span class="badge bg-warning">Processando...</span>';
                        actions = '<button class="btn btn-sm btn-secondary disabled"><span class="spinner-border spinner-border-sm"></span> Aguarde</button>';
                        details = file.started_at ? `<small class="text-muted">Iniciado: ${new Date(file.started_at).toLocaleTimeString()}</small>` : '';
                    } else if (status === 'completed') {
                        statusBadge = '<span class="badge bg-success">Completo</span>';
                        actions = `
                            <button class="btn btn-sm btn-success view-btn" data-filename="${this.escapeHtml(file.filename)}.txt" data-original="${this.escapeHtml(file.original_name || file.filename)}">
                                <i class="bi bi-eye"></i> Ver
                            </button>
                            <a href="./api/transcription/${this.escapeHtml(file.filename)}.txt" download class="btn btn-sm btn-outline-primary">
                                <i class="bi bi-download"></i> Baixar
                            </a>
                        `;
                        details = file.processing_time ? `<small class="text-muted">${file.processing_time}s</small>` : '';
                    } else if (status === 'error') {
                        statusBadge = '<span class="badge bg-danger">Erro</span>';
                        actions = '<button class="btn btn-sm btn-outline-danger disabled">Erro</button>';
                        details = file.error ? `<small class="text-danger">${this.escapeHtml(file.error.substring(0, 50))}...</small>` : '';
                    } else {
                        statusBadge = '<span class="badge bg-secondary">Desconhecido</span>';
                        actions = '';
                    }
                }

                tableHtml += `
                    <tr>
                        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(file.original_name || file.filename)}">
                            ${this.escapeHtml(file.original_name || file.filename)}
                        </td>
                        <td>${statusBadge}</td>
                        <td>${details}</td>
                        <td>${actions}</td>
                    </tr>
                `;
            });

            tableHtml += `
                        </tbody>
                    </table>
                </div>
            `;

            this.filesTableContainer.innerHTML = tableHtml;

            // Adicionar eventos aos botões usando event delegation no container
            // Isso evita problemas de listeners duplicados
            this.filesTableContainer.onclick = (e) => {
                if (e.target.closest('.transcribe-btn')) {
                    const button = e.target.closest('.transcribe-btn');
                    const filename = button.getAttribute('data-filename');
                    if (filename) {
                        this.startTranscription(filename);
                    }
                }
                
                if (e.target.closest('.view-btn')) {
                    const button = e.target.closest('.view-btn');
                    const filename = button.getAttribute('data-filename');
                    const originalName = button.getAttribute('data-original');
                    if (filename && originalName) {
                        this.viewTranscription(filename, originalName);
                    }
                }
            };
        }

        escapeHtml(text) {
            if (!text) return '';
            const map = {
                '&': '&amp;',
                '<': '<',
                '>': '>',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.toString().replace(/[&<>"']/g, function(m) { return map[m]; });
        }

        async startTranscription(filename) {
            // Verificação rápida local para evitar spam de requisições iguais
            if (this.transcriptionRequests.has(filename)) {
                console.log(`Transcrição já solicitada recentemente para: ${filename}. Ignorando.`);
                return;
            }

            // Marcar como solicitada
            this.transcriptionRequests.add(filename);
            // Remover do Set após um tempo para permitir retries manuais se necessário
            setTimeout(() => {
                this.transcriptionRequests.delete(filename);
            }, 60000); // 1 minuto

            try {
                // Encontrar os botões e desabilitá-los temporariamente
                const buttons = document.querySelectorAll(`.transcribe-btn[data-filename="${this.escapeHtml(filename)}"]`);
                buttons.forEach(btn => {
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Iniciando...';
                    btn.disabled = true;
                    // Armazenar HTML original para restauração em caso de erro
                    btn.originalHtml = originalHtml;
                });

                const response = await fetch(`./api/transcribe/${encodeURIComponent(filename)}`, {
                    method: 'POST'
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    // Se for 404, é esperado após conclusão. Não mostrar alerta genérico.
                    if (response.status === 404) {
                        console.warn(`Arquivo não encontrado para transcrição: ${filename}. Pode já ter sido processado.`);
                        // Atualizar a lista para refletir o novo status
                        setTimeout(() => {
                            this.loadProcessedFiles();
                        }, 2000); // Pequeno delay para o backend atualizar
                        return;
                    }
                    throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                console.log('Transcription started:', data);
                
                // Atualizar a lista imediatamente para refletir o novo status
                setTimeout(() => {
                    this.loadProcessedFiles();
                }, 2000); // Pequeno delay para o backend atualizar o status
                
            } catch (error) {
                console.error('Error starting transcription:', error);
                // Só mostrar alerta para erros inesperados, não para 404
                if (error.message && !error.message.includes('404')) {
                    if (alert) {
                        alert(`Erro ao iniciar transcrição: ${error.message}`);
                    }
                }
                
                // Restaurar botão em caso de erro (exceto 404)
                const buttons = document.querySelectorAll(`.transcribe-btn[data-filename="${this.escapeHtml(filename)}"]`);
                buttons.forEach(btn => {
                    if (btn.originalHtml) {
                        btn.innerHTML = btn.originalHtml;
                    } else {
                        btn.innerHTML = '<i class="bi bi-translate"></i> Transcrever';
                    }
                    btn.disabled = false;
                });
            } finally {
                // Em caso de sucesso ou erro (exceto 404), remover do Set após um tempo curto
                // Para 404, já removemos acima. Para outros casos, remover após 10s para evitar spam.
                if (!this.transcriptionRequests.has(filename)) return; // Já foi removido no caso 404
                setTimeout(() => {
                    this.transcriptionRequests.delete(filename);
                }, 10000);
            }
        }

        async viewTranscription(filename, originalName) {
            // Inicializar modal
            let modal = this.getModalInstance();
            if (!modal) {
                // Tentar criar nova instância
                const modalElement = document.getElementById('transcriptionModal');
                if (modalElement && typeof bootstrap !== 'undefined') {
                    modal = new bootstrap.Modal(modalElement);
                    this.modalInstance = modal;
                }
            }
            
            if (modal) {
                modal.show();
            } else {
                // Fallback: mostrar modal diretamente
                const modalElement = document.getElementById('transcriptionModal');
                if (modalElement) {
                    modalElement.style.display = 'block';
                    modalElement.classList.add('show');
                    document.body.classList.add('modal-open');
                }
            }
            
            if (this.modalLoading && this.transcriptionContent) {
                this.modalLoading.classList.remove('d-none');
                this.transcriptionContent.classList.add('d-none');
            }

            try {
                const response = await fetch(`./api/transcription/${encodeURIComponent(filename)}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                
                if (this.modalLoading && this.transcriptionContent && this.modalTranscriptionText && this.modalFileInfo) {
                    this.modalLoading.classList.add('d-none');
                    this.transcriptionContent.classList.remove('d-none');
                    this.modalTranscriptionText.textContent = data.transcription;
                    this.modalFileInfo.textContent = `Arquivo: ${originalName}`;
                    
                    // Configurar download
                    if (this.downloadTranscription) {
                        this.downloadTranscription.href = `./api/transcription/${encodeURIComponent(filename)}`;
                        this.downloadTranscription.download = `${originalName.replace(/\.[^/.]+$/, "")}.txt`;
                    }
                }
                
            } catch (error) {
                console.error('Error loading transcription:', error);
                if (this.modalLoading && this.transcriptionContent && this.modalTranscriptionText) {
                    this.modalLoading.classList.add('d-none');
                    this.transcriptionContent.classList.remove('d-none');
                    this.modalTranscriptionText.textContent = 'Erro ao carregar transcrição';
                }
            }
        }

        copyModalToClipboard() {
            if (this.modalTranscriptionText) {
                const text = this.modalTranscriptionText.textContent;
                navigator.clipboard.writeText(text).then(() => {
                    if (this.copyModalText) {
                        const originalText = this.copyModalText.innerHTML;
                        this.copyModalText.innerHTML = '<i class="bi bi-check"></i> Copiado!';
                        setTimeout(() => {
                            this.copyModalText.innerHTML = originalText;
                        }, 2000);
                    }
                });
            }
        }

        // Método para parar o auto-refresh quando necessário
        stopAutoRefresh() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
        }
    }

    // Initialize the app
    try {
        window.whisperApp = new WhisperTranscriber();
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}

// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Garantir que o app seja reinicializado se necessário
window.addEventListener('load', function() {
    if (!window.whisperApp) {
        initApp();
    }
});