from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import tempfile
import os
import uuid

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

# Configurar limite de upload (100MB)
from fastapi import Body, Request
from fastapi.responses import JSONResponse

@app.middleware("http")
async def increase_timeout(request: Request, call_next):
    response = await call_next(request)
    return response

# Inicializar o modelo Whisper
model_size = "medium"
model = WhisperModel(model_size, device="cpu", compute_type="int8")

@app.get("/")
async def root():
    return {"message": "Whisper Transcription API"}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        # Validar tipo de arquivo
        if not file.content_type.startswith("audio/"):
            raise HTTPException(status_code=400, detail="Arquivo deve ser de áudio")
        
        # Log para debug
        print(f"Recebendo arquivo: {file.filename}, tamanho: {file.size if hasattr(file, 'size') else 'desconhecido'}")
        
        # Criar arquivo temporário
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_file_path = tmp_file.name
        
        print(f"Arquivo salvo temporariamente em: {tmp_file_path}")
        
        try:
            # Transcrever áudio
            segments, info = model.transcribe(tmp_file_path, beam_size=5)
            
            transcription = ""
            for segment in segments:
                transcription += segment.text + " "
            
            return {
                "filename": file.filename,
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "transcription": transcription.strip()
            }
        finally:
            # Remover arquivo temporário
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)
                print(f"Arquivo temporário removido: {tmp_file_path}")
            
    except Exception as e:
        print(f"Erro durante transcrição: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)