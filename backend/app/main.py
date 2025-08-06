from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import tempfile
import os
import time
import logging
import uuid
import json
from typing import List
import aiofiles
from datetime import datetime
import asyncio

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Whisper Transcription API",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Diretórios
INPUT_DIR = "/app/inputs_temp"
OUTPUT_DIR = "/app/outputs"
os.makedirs(INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Configurar tamanho do modelo via variável de ambiente
model_size = os.getenv("WHISPER_MODEL_SIZE", "medium")
device = os.getenv("WHISPER_DEVICE", "cpu")
compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

# Variável global para o modelo
model = None
model_loaded = False

async def load_model():
    """Carregar modelo Whisper durante a inicialização"""
    global model, model_loaded
    logger.info(f"Carregando modelo Whisper: {model_size} no device: {device}")
    
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        model_loaded = True
        logger.info("✅ Modelo Whisper carregado com sucesso! API pronta para uso.")
    except Exception as e:
        logger.error(f"❌ Erro ao carregar modelo Whisper: {str(e)}")
        raise

# Carregar modelo durante a inicialização
@app.on_event("startup")
async def startup_event():
    await load_model()

@app.get("/")
async def root():
    return {
        "message": "Whisper Transcription API",
        "model_size": model_size,
        "device": device,
        "model_loaded": model_loaded
    }

def get_unique_filename(directory, original_filename):
    """Gerar nome de arquivo único adicionando número se necessário"""
    base_name, extension = os.path.splitext(original_filename)
    counter = 1
    new_filename = original_filename
    
    while os.path.exists(os.path.join(directory, new_filename)):
        new_filename = f"{base_name}({counter}){extension}"
        counter += 1
    
    return new_filename

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """Upload de múltiplos arquivos"""
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Modelo ainda não carregado, aguarde...")
    
    uploaded_files = []
    
    for file in files:
        if not file.content_type.startswith("audio/"):
            raise HTTPException(status_code=400, detail=f"Arquivo {file.filename} não é de áudio")
        
        # Gerar nome único para evitar conflitos
        unique_filename = get_unique_filename(INPUT_DIR, file.filename)
        file_path = os.path.join(INPUT_DIR, unique_filename)
        
        # Salvar arquivo
        async with aiofiles.open(file_path, 'wb') as out_file:
            content = await file.read()
            await out_file.write(content)
        
        uploaded_files.append({
            "filename": unique_filename,
            "original_name": file.filename,
            "size": len(content),
            "upload_time": datetime.now().isoformat()
        })
        
        logger.info(f"Arquivo salvo: {unique_filename} ({len(content)} bytes)")
    
    return {
        "message": f"{len(uploaded_files)} arquivos enviados com sucesso",
        "files": uploaded_files
    }

@app.post("/transcribe/{filename}")
async def transcribe_file(filename: str, background_tasks: BackgroundTasks):
    """Iniciar transcrição de um arquivo específico"""
    if not model_loaded:
        raise HTTPException(status_code=503, detail="Modelo não disponível")
    
    file_path = os.path.join(INPUT_DIR, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    
    # Criar arquivo de status indicando que a transcrição começou
    status_data = {
        "status": "processing",
        "started_at": datetime.now().isoformat()
    }
    status_path = os.path.join(OUTPUT_DIR, f"{os.path.splitext(filename)[0]}_status.json")
    async with aiofiles.open(status_path, 'w') as f:
        await f.write(json.dumps(status_data, indent=2))
    
    # Iniciar transcrição em background
    background_tasks.add_task(process_transcription, filename)
    
    return {
        "message": "Transcrição iniciada",
        "filename": filename,
        "status": "processing"
    }

async def process_transcription(filename: str):
    """Processar transcrição em background"""
    start_time = time.time()
    file_path = os.path.join(INPUT_DIR, filename)
    output_filename = f"{os.path.splitext(filename)[0]}.txt"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    status_path = os.path.join(OUTPUT_DIR, f"{os.path.splitext(filename)[0]}_status.json")
    
    try:
        logger.info(f"Iniciando transcrição para arquivo: {filename}")
        
        # Transcrever áudio
        logger.info("Iniciando processo de transcrição...")
        segments, info = model.transcribe(file_path, beam_size=5)
        
        logger.info(f"Detecção de idioma: {info.language} (probabilidade: {info.language_probability:.2f})")
        logger.info(f"Duração do áudio: {info.duration:.2f} segundos")
        
        transcription = ""
        segment_count = 0
        
        for segment in segments:
            transcription += segment.text + " "
            segment_count += 1
            if segment_count <= 10:  # Log apenas os primeiros 10 segmentos
                logger.debug(f"Segmento {segment_count}: [{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
        
        end_time = time.time()
        processing_time = end_time - start_time
        
        # Salvar transcrição
        async with aiofiles.open(output_path, 'w', encoding='utf-8') as f:
            await f.write(transcription.strip())
        
        # Salvar metadados
        metadata = {
            "original_filename": filename,
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "processing_time": round(processing_time, 2),
            "segments_count": segment_count,
            "transcription_file": output_filename,
            "completed_at": datetime.now().isoformat()
        }
        
        metadata_path = os.path.join(OUTPUT_DIR, f"{os.path.splitext(filename)[0]}_metadata.json")
        async with aiofiles.open(metadata_path, 'w') as f:
            await f.write(json.dumps(metadata, indent=2, ensure_ascii=False))
        
        # Atualizar status para completed
        status_data = {
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "processing_time": round(processing_time, 2)
        }
        async with aiofiles.open(status_path, 'w') as f:
            await f.write(json.dumps(status_data, indent=2))
        
        # Remover arquivo de áudio original após transcrição completa
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Arquivo de áudio original removido: {filename}")
        
        logger.info(f"Transcrição concluída! {segment_count} segmentos processados em {processing_time:.2f} segundos")
        logger.info(f"Transcrição salva em: {output_path}")
        
    except Exception as e:
        logger.error(f"Erro durante transcrição de {filename}: {str(e)}", exc_info=True)
        # Salvar erro em status
        error_status = {
            "status": "error",
            "error": str(e),
            "completed_at": datetime.now().isoformat()
        }
        async with aiofiles.open(status_path, 'w') as f:
            await f.write(json.dumps(error_status, indent=2))

@app.get("/files")
async def list_files():
    """Listar todos os arquivos disponíveis"""
    files = []
    
    # Arquivos de entrada (áudios originais)
    if os.path.exists(INPUT_DIR):
        for filename in sorted(os.listdir(INPUT_DIR)):
            file_path = os.path.join(INPUT_DIR, filename)
            if os.path.isfile(file_path):
                stat = os.stat(file_path)
                files.append({
                    "type": "input",
                    "filename": filename,
                    "original_name": filename,
                    "size": stat.st_size,
                    "upload_time": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    "status": "uploaded"
                })
    
    # Arquivos de saída (transcrições e status)
    if os.path.exists(OUTPUT_DIR):
        processed_files = set()
        
        for filename in sorted(os.listdir(OUTPUT_DIR)):
            if filename.endswith('_status.json'):
                # Arquivo de status
                base_name = filename.replace('_status.json', '')
                if base_name in processed_files:
                    continue
                    
                processed_files.add(base_name)
                
                status_path = os.path.join(OUTPUT_DIR, filename)
                metadata_path = os.path.join(OUTPUT_DIR, f"{base_name}_metadata.json")
                
                # Ler status
                status_data = {}
                if os.path.exists(status_path):
                    async with aiofiles.open(status_path, 'r') as f:
                        status_content = await f.read()
                        status_data = json.loads(status_content)
                
                # Ler metadados se existirem
                metadata = {}
                if os.path.exists(metadata_path):
                    async with aiofiles.open(metadata_path, 'r') as f:
                        metadata_content = await f.read()
                        metadata = json.loads(metadata_content)
                
                # Verificar se existe arquivo de transcrição
                txt_file = f"{base_name}.txt"
                txt_path = os.path.join(OUTPUT_DIR, txt_file)
                txt_exists = os.path.exists(txt_path)
                
                files.append({
                    "type": "processed",
                    "filename": base_name,
                    "original_name": metadata.get('original_filename', base_name),
                    "status": status_data.get('status', 'unknown'),
                    "started_at": status_data.get('started_at'),
                    "completed_at": status_data.get('completed_at'),
                    "processing_time": status_data.get('processing_time'),
                    "language": metadata.get('language'),
                    "duration": metadata.get('duration'),
                    "error": status_data.get('error') if status_data.get('status') == 'error' else None
                })
            elif filename.endswith('.txt') and not filename.endswith('_status.json'):
                # Arquivo de transcrição sem status (transcrição concluída)
                base_name = os.path.splitext(filename)[0]
                if base_name in processed_files:
                    continue
                    
                # Verificar se já existe status para este arquivo
                status_path = os.path.join(OUTPUT_DIR, f"{base_name}_status.json")
                if os.path.exists(status_path):
                    continue  # Já foi processado acima
                    
                processed_files.add(base_name)
                
                txt_path = os.path.join(OUTPUT_DIR, filename)
                metadata_path = os.path.join(OUTPUT_DIR, f"{base_name}_metadata.json")
                
                stat = os.stat(txt_path)
                metadata = {}
                if os.path.exists(metadata_path):
                    async with aiofiles.open(metadata_path, 'r') as f:
                        metadata_content = await f.read()
                        metadata = json.loads(metadata_content)
                
                files.append({
                    "type": "processed",
                    "filename": base_name,
                    "original_name": metadata.get('original_filename', base_name),
                    "status": "completed",
                    "completed_at": metadata.get('completed_at'),
                    "processing_time": metadata.get('processing_time'),
                    "language": metadata.get('language'),
                    "duration": metadata.get('duration')
                })
    
    return {"files": files}

@app.get("/transcription/{filename}")
async def get_transcription(filename: str):
    """Obter transcrição de um arquivo"""
    output_path = os.path.join(OUTPUT_DIR, filename)
    
    if not os.path.exists(output_path):
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
    
    async with aiofiles.open(output_path, 'r', encoding='utf-8') as f:
        transcription = await f.read()
    
    return {
        "filename": filename,
        "transcription": transcription
    }

@app.delete("/files/{filename}")
async def delete_file(filename: str):
    """Deletar arquivo"""
    # Deletar arquivo de entrada
    input_path = os.path.join(INPUT_DIR, filename)
    if os.path.exists(input_path):
        os.remove(input_path)
    
    # Deletar arquivos de saída relacionados
    output_base = os.path.splitext(filename)[0]
    output_txt = os.path.join(OUTPUT_DIR, f"{output_base}.txt")
    output_meta = os.path.join(OUTPUT_DIR, f"{output_base}_metadata.json")
    output_status = os.path.join(OUTPUT_DIR, f"{output_base}_status.json")
    
    if os.path.exists(output_txt):
        os.remove(output_txt)
    if os.path.exists(output_meta):
        os.remove(output_meta)
    if os.path.exists(output_status):
        os.remove(output_status)
    
    return {"message": "Arquivo deletado com sucesso"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)