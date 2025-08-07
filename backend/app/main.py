# ~/apps/now-utilities/backend/app/main.py
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks # Importação correta
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import tempfile
import os
import time
import logging
import uuid
import json
from typing import List # Importação correta para List
import aiofiles
from datetime import datetime

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

logger.info(f"Carregando modelo Whisper: {model_size} no device: {device}")

# Inicializar o modelo Whisper com logging
model = WhisperModel(model_size, device=device, compute_type=compute_type)
logger.info("✅ Modelo Whisper carregado com sucesso! API pronta para uso.")

@app.get("/")
async def root():
    return {
        "message": "Whisper Transcription API",
        "model_size": model_size,
        "device": device
    }

def get_unique_filename(original_filename):
    """Gerar nome único para evitar sobreposição de arquivos"""
    base_name, extension = os.path.splitext(original_filename)
    counter = 1
    new_filename = original_filename
    
    while os.path.exists(os.path.join(INPUT_DIR, new_filename)):
        new_filename = f"{base_name}_{counter}{extension}"
        counter += 1
    
    return new_filename

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """Upload de múltiplos arquivos"""
    logger.info("Recebendo arquivos para upload...")
    uploaded_files = []
    
    for file in files:
        if not file.content_type.startswith("audio/"):
            raise HTTPException(status_code=400, detail=f"Arquivo {file.filename} não é de áudio")
        
        # Gerar nome único para evitar conflitos
        unique_filename = get_unique_filename(file.filename)
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
    """Iniciar transcrição de um arquivo específico em segundo plano."""
    logger.info(f"Solicitando transcrição para arquivo: {filename}")
    
    file_path = os.path.join(INPUT_DIR, filename)
    
    if not os.path.exists(file_path):
        logger.warning(f"Arquivo solicitado para transcrição não encontrado: {filename}")
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    base_name = os.path.splitext(filename)[0]
    status_path = os.path.join(OUTPUT_DIR, f"{base_name}_status.json")

    # Verificar status existente
    current_status = None
    if os.path.exists(status_path):
        try:
            async with aiofiles.open(status_path, 'r', encoding='utf-8') as f:
                status_data = json.loads(await f.read())
            current_status = status_data.get("status")
        except Exception as e:
            logger.error(f"Erro ao ler status existente para {filename}: {e}")

    # Impedir iniciar transcrição se já estiver em andamento
    if current_status == "processing":
        logger.info(f"Transcrição já em andamento para {filename}.")
        return {
            "message": "Transcrição já em andamento",
            "filename": filename,
            "status": "processing"
        }

    # Se não houver status ou for um status que permite reiniciar, iniciar transcrição em background
    logger.info(f"Iniciando nova transcrição em background para arquivo: {filename}")
    
    # Criar/atualizar arquivo de status indicando que a transcrição começou
    status_data = {
        "status": "processing",
        "started_at": datetime.now().isoformat()
    }
    async with aiofiles.open(status_path, 'w', encoding='utf-8') as f:
        await f.write(json.dumps(status_data, indent=2, ensure_ascii=False))
    
    # Agendar a transcrição para rodar em background
    background_tasks.add_task(process_transcription, filename)
    
    return {
        "message": "Transcrição iniciada em background",
        "filename": filename,
        "status": "processing"
    }

async def process_transcription(filename: str):
    """Processar transcrição em background."""
    start_time = time.time()
    file_path = os.path.join(INPUT_DIR, filename)
    output_filename = f"{os.path.splitext(filename)[0]}.txt"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    status_path = os.path.join(OUTPUT_DIR, f"{os.path.splitext(filename)[0]}_status.json")
    
    # Verificação extra de segurança
    if not os.path.exists(file_path):
        error_msg = f"Arquivo de origem não encontrado durante processamento: {filename}"
        logger.error(error_msg)
        error_status = {
            "status": "error",
            "error": error_msg,
            "completed_at": datetime.now().isoformat()
        }
        try:
            async with aiofiles.open(status_path, 'w', encoding='utf-8') as f:
                await f.write(json.dumps(error_status, indent=2, ensure_ascii=False))
        except:
             pass # Ignorar erro ao salvar status se o arquivo original já não existe
        return

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
        
        # Salvar transcrição com codificação UTF-8
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
        async with aiofiles.open(metadata_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(metadata, indent=2, ensure_ascii=False))
        
        # Atualizar status para completed
        status_data = {
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "processing_time": round(processing_time, 2)
        }
        async with aiofiles.open(status_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(status_data, indent=2, ensure_ascii=False))
        
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
        try:
            async with aiofiles.open(status_path, 'w', encoding='utf-8') as f:
                await f.write(json.dumps(error_status, indent=2, ensure_ascii=False))
        except Exception as write_error:
             logger.error(f"Falha ao salvar status de erro para {filename}: {write_error}")

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
    
    # Arquivos de saída (transcrições, status, metadados)
    if os.path.exists(OUTPUT_DIR):
        processed_files = {} # Dicionário para armazenar informações por base_name
        
        for filename in sorted(os.listdir(OUTPUT_DIR)):
            file_path = os.path.join(OUTPUT_DIR, filename)
            if not os.path.isfile(file_path):
                continue
                
            if filename.endswith('_status.json'):
                # Arquivo de status
                base_name = filename.replace('_status.json', '')
                if base_name not in processed_files:
                    processed_files[base_name] = {"base_name": base_name}
                
                # Ler status
                try:
                    async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
                        status_data = json.loads(await f.read())
                    processed_files[base_name].update(status_data)
                    processed_files[base_name]["status_file_exists"] = True
                except Exception as e:
                    logger.error(f"Erro ao ler status {filename}: {e}")
                    
            elif filename.endswith('.txt') and not filename.endswith('_status.json'):
                # Arquivo de transcrição
                base_name = os.path.splitext(filename)[0]
                if base_name not in processed_files:
                    processed_files[base_name] = {"base_name": base_name}
                processed_files[base_name]["transcription_file"] = filename
                
            elif filename.endswith('_metadata.json'):
                # Arquivo de metadados
                base_name = filename.replace('_metadata.json', '')
                if base_name not in processed_files:
                    processed_files[base_name] = {"base_name": base_name}
                
                # Ler metadados
                try:
                    async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
                        metadata = json.loads(await f.read())
                    processed_files[base_name].update(metadata)
                    processed_files[base_name]["metadata_file_exists"] = True
                except Exception as e:
                    logger.error(f"Erro ao ler metadados {filename}: {e}")

        # Converter dicionário em lista e formatar
        for base_name, file_info in processed_files.items():
            # Determinar o status final
            status = file_info.get("status", "unknown")
            if status == "unknown" and file_info.get("transcription_file"):
                status = "completed"
            elif status == "unknown":
                status = "processing" # Ou outro status apropriado se não houver status.json ainda
            
            files.append({
                "type": "processed",
                "filename": base_name,
                "original_name": file_info.get("original_filename", base_name),
                "status": status,
                "started_at": file_info.get("started_at"),
                "completed_at": file_info.get("completed_at"),
                "processing_time": file_info.get("processing_time"),
                "language": file_info.get("language"),
                "duration": file_info.get("duration"),
                "error": file_info.get("error") if status == "error" else None,
                "transcription_file": file_info.get("transcription_file")
            })
    
    # logger.info(f"Arquivos listados: {files}") # Para debug
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
