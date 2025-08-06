from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import tempfile
import os
import time
import logging
import os

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

# Configurar tamanho do modelo via variável de ambiente
model_size = os.getenv("WHISPER_MODEL_SIZE", "medium")
device = os.getenv("WHISPER_DEVICE", "cpu")
compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

logger.info(f"Carregando modelo Whisper: {model_size} no device: {device}")

# Inicializar o modelo Whisper com logging
model = WhisperModel(model_size, device=device, compute_type=compute_type)
logger.info("Modelo Whisper carregado com sucesso!")

@app.get("/")
async def root():
    return {
        "message": "Whisper Transcription API",
        "model_size": model_size,
        "device": device
    }

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    start_time = time.time()
    logger.info(f"Iniciando transcrição para arquivo: {file.filename}")
    
    try:
        # Validar tipo de arquivo
        if not file.content_type.startswith("audio/"):
            logger.warning(f"Tipo de arquivo inválido: {file.content_type}")
            raise HTTPException(status_code=400, detail="Arquivo deve ser de áudio")
        
        # Ler conteúdo do arquivo
        content = await file.read()
        file_size = len(content)
        logger.info(f"Tamanho do arquivo: {file_size} bytes ({file_size/1024/1024:.2f} MB)")
        
        # Resetar posição do cursor
        await file.seek(0)
        
        # Criar arquivo temporário
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_file_path = tmp_file.name
        
        logger.info(f"Arquivo salvo temporariamente em: {tmp_file_path}")
        
        try:
            # Transcrever áudio
            logger.info("Iniciando processo de transcrição...")
            segments, info = model.transcribe(tmp_file_path, beam_size=5)
            
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
            
            logger.info(f"Transcrição concluída! {segment_count} segmentos processados em {processing_time:.2f} segundos")
            
            result = {
                "filename": file.filename,
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "transcription": transcription.strip(),
                "processing_time": round(processing_time, 2),
                "segments_count": segment_count
            }
            
            logger.info(f"Resultado: {result['transcription'][:100]}...")
            return result
            
        finally:
            # Remover arquivo temporário
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)
                logger.info(f"Arquivo temporário removido: {tmp_file_path}")
            
    except Exception as e:
        logger.error(f"Erro durante transcrição: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)