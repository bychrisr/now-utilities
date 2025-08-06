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
                this.modalInstance = new bootstrap.Modal(document.getElementById('transcriptionModal'));
            }
            return this.modalInstance;
        }

        bindEvents() {
            // Browse button click
            this.browseBtn.addEventListener('click', () => {
                this.fileInput.click();
            });

            // File input change (agora com multiple)
            this.fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.addFiles(Array.from(e.target.files));
                }
            });

            // Drop zone events
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

            // Clear files
            this.clearFiles.addEventListener('click', () => {
                this.clearAllFiles();
            });

            // Form submit
            this.form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (this.files.length > 0) {
                    this.uploadFiles();
                }
            });

            // Refresh files
            this.refreshFiles.addEventListener('click', () => {
                this.loadProcessedFiles();
            });

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
                            <span>${file.name}</span>
                            <small class="text-muted">(${(file.size/1024/1024).toFixed(2)} MB)</small>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger remove-file" data-index="${index}">
                            <i class="bi bi-x"></i>
                        </button>
                    `;
                    this.filesContainer.appendChild(fileElement);
                });
                
                // Adicionar eventos para remover arquivos individuais
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

        removeFile(index) {
            this.files.splice(index, 1);
            this.updateFileList();
        }

        clearAllFiles() {
            this.files = [];
            this.updateFileList();
        }

        async uploadFiles() {
            const formData = new FormData();
            this.files.forEach(file => {
                formData.append('files', file);
            });

            // Show loading
            this.loading.style.display = 'block';
            this.submitBtn.disabled = true;
            this.submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';

            try {
                const response = await fetch('/api/upload', {
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
                
                alert(`${data.files.length} arquivos enviados com sucesso!`);
                
            } catch (error) {
                console.error('Error:', error);
                alert('Erro ao enviar os arquivos. Por favor, tente novamente.');
            } finally {
                // Hide loading
                this.loading.style.display = 'none';
                this.submitBtn.disabled = false;
                this.submitBtn.innerHTML = '<i class="bi bi-upload me-2"></i>Enviar Arquivos';
            }
        }

        startAutoRefresh() {
            // Auto-refresh a cada 10 segundos
            this.refreshInterval = setInterval(() => {
                this.loadProcessedFiles();
            }, 10000);
        }

        async loadProcessedFiles() {
            try {
                const response = await fetch('/api/files');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                this.processedFiles = data.files || [];
                this.renderFilesTable();
            } catch (error) {
                console.error('Error loading files:', error);
                this.filesTableContainer.innerHTML = '<div class="alert alert-danger">Erro ao carregar arquivos</div>';
            }
        }

        renderFilesTable() {
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

            this.processedFiles.forEach(file => {
                let statusBadge = '';
                let actions = '';
                let details = '';
                
                if (file.type === 'input') {
                    // Arquivo de áudio ainda não processado
                    statusBadge = '<span class="badge bg-info">Aguardando</span>';
                    actions = `
                        <button class="btn btn-sm btn-primary transcribe-btn" data-filename="${file.filename}">
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
                            <button class="btn btn-sm btn-success view-btn" data-filename="${file.filename}.txt" data-original="${file.original_name}">
                                <i class="bi bi-eye"></i> Ver
                            </button>
                            <a href="/api/transcription/${file.filename}.txt" download class="btn btn-sm btn-outline-primary">
                                <i class="bi bi-download"></i> Baixar
                            </a>
                        `;
                        details = file.processing_time ? `<small class="text-muted">${file.processing_time}s</small>` : '';
                    } else if (status === 'error') {
                        statusBadge = '<span class="badge bg-danger">Erro</span>';
                        actions = '<button class="btn btn-sm btn-outline-danger disabled">Erro</button>';
                        details = file.error ? `<small class="text-danger">${file.error.substring(0, 50)}...</small>` : '';
                    } else {
                        statusBadge = '<span class="badge bg-secondary">Desconhecido</span>';
                        actions = '';
                    }
                }

                tableHtml += `
                    <tr>
                        <td>${file.original_name || file.filename}</td>
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

            // Adicionar eventos aos botões (delegated events)
            this.filesTableContainer.addEventListener('click', (e) => {
                if (e.target.closest('.transcribe-btn')) {
                    const button = e.target.closest('.transcribe-btn');
                    const filename = button.getAttribute('data-filename');
                    this.startTranscription(filename);
                }
                
                if (e.target.closest('.view-btn')) {
                    const button = e.target.closest('.view-btn');
                    const filename = button.getAttribute('data-filename');
                    const originalName = button.getAttribute('data-original');
                    this.viewTranscription(filename, originalName);
                }
            });
        }

        async startTranscription(filename) {
            try {
                // Encontrar os botões
                const buttons = document.querySelectorAll(`.transcribe-btn[data-filename="${filename}"]`);
                buttons.forEach(btn => {
                    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Iniciando...';
                    btn.disabled = true;
                });

                const response = await fetch(`/api/transcribe/${filename}`, {
                    method: 'POST'
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                console.log('Transcription started:', data);
                
                // Atualizar a lista imediatamente
                setTimeout(() => {
                    this.loadProcessedFiles();
                }, 1000);
                
            } catch (error) {
                console.error('Error starting transcription:', error);
                alert('Erro ao iniciar transcrição. Por favor, tente novamente.');
                // Restaurar botão
                const buttons = document.querySelectorAll(`.transcribe-btn[data-filename="${filename}"]`);
                buttons.forEach(btn => {
                    btn.innerHTML = '<i class="bi bi-translate"></i> Transcrever';
                    btn.disabled = false;
                });
            }
        }

        async viewTranscription(filename, originalName) {
            // Inicializar modal
            const modal = this.getModalInstance();
            if (modal) {
                modal.show();
            } else {
                // Fallback: mostrar modal diretamente
                document.getElementById('transcriptionModal').style.display = 'block';
            }
            
            this.modalLoading.classList.remove('d-none');
            this.transcriptionContent.classList.add('d-none');

            try {
                const response = await fetch(`/api/transcription/${filename}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                
                this.modalLoading.classList.add('d-none');
                this.transcriptionContent.classList.remove('d-none');
                this.modalTranscriptionText.textContent = data.transcription;
                this.modalFileInfo.textContent = `Arquivo: ${originalName}`;
                
                // Configurar download
                this.downloadTranscription.href = `/api/transcription/${filename}`;
                this.downloadTranscription.download = `${originalName.replace(/\.[^/.]+$/, "")}.txt`;
                
            } catch (error) {
                console.error('Error loading transcription:', error);
                this.modalLoading.classList.add('d-none');
                this.transcriptionContent.classList.remove('d-none');
                this.modalTranscriptionText.textContent = 'Erro ao carregar transcrição';
            }
        }

        copyModalToClipboard() {
            const text = this.modalTranscriptionText.textContent;
            navigator.clipboard.writeText(text).then(() => {
                const originalText = this.copyModalText.innerHTML;
                this.copyModalText.innerHTML = '<i class="bi bi-check"></i> Copiado!';
                setTimeout(() => {
                    this.copyModalText.innerHTML = originalText;
                }, 2000);
            });
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
    window.whisperApp = new WhisperTranscriber();
}

// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}