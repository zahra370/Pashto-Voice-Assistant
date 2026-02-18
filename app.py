import os
import time
import wave
import json
import base64
import tempfile
import numpy as np
from flask import Flask, render_template, request, jsonify, session, Response
from werkzeug.utils import secure_filename
import pygame
from datetime import datetime
from dotenv import load_dotenv
import requests
import sounddevice as sd
import soundfile as sf
import threading
import queue
import re
import subprocess
import torch
from pydub import AudioSegment
from transformers import AutoProcessor, AutoModelForCTC
import io

# Load environment variables
load_dotenv()

# Set the API key directly
os.environ['GOOGLE_API_KEY'] = "AIzaSyAdyvv7hB_npsx5S2lVREE34WzA2HQlWBI"

# UpliftAI TTS Configuration
UPLIFT_AI_API_KEY = "sk_api_0d743aca248417c28a04e7b5bf2a643890990485074671a72a8498b301de3afa"
UPLIFT_AI_TTS_URL = "https://api.upliftai.org/v1/synthesis/text-to-speech"
UPLIFT_AI_VOICE_ID = "v_8eelc901"  # Pashto voice
UPLIFT_AI_OUTPUT_FORMAT = "MP3_22050_128"

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dev-secret-key-change-this-for-production')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Initialize Pashto ASR model only
print("=" * 60)
print("Initializing Pashto ASR model...")
try:
    # Pashto ASR (v6) - PRIMARY MODEL
    pashto_asr_model_name = "ihanif/pashto-asr-v6"
    asr_processor = AutoProcessor.from_pretrained(pashto_asr_model_name)
    asr_model = AutoModelForCTC.from_pretrained(pashto_asr_model_name)
    asr_model.eval()
    print("✓ Pashto ASR v6 model loaded successfully")
    
    # Move model to GPU if available
    if torch.cuda.is_available():
        asr_model = asr_model.to('cuda')
        print("✓ ASR model moved to GPU")
    else:
        print("⚠ ASR model using CPU")
        
except Exception as e:
    print(f"✗ Error loading Pashto ASR model: {e}")
    print("Please install the model with: pip install transformers torch")
    print("Or check Hugging Face access")
    asr_processor = asr_model = None

# Available voices
AVAILABLE_VOICES = [
    {"id": "v_8eelc901", "name": "UpliftAI Pashto Voice", "description": "UpliftAI's Pashto text-to-speech"}
]

# Audio recording variables
audio_queue = queue.Queue()
is_recording = False
is_processing = False
recording_data = []
sample_rate = 16000
stream = None
last_voice_activity = 0
SILENCE_THRESHOLD = 0.01
SILENCE_TIMEOUT = 3.0

# Store audio in memory instead of files
audio_store = {}
latest_results = {}

# -----------------------------
# HELPER FUNCTIONS
# -----------------------------

def has_voice_activity(audio_chunk):
    """Check if audio chunk contains voice activity"""
    if len(audio_chunk) == 0:
        return False
    
    try:
        rms = np.sqrt(np.mean(np.square(audio_chunk)))
        return rms > SILENCE_THRESHOLD
    except:
        return False

def start_server_recording():
    """Start server-side audio recording"""
    global is_recording, recording_data, stream, last_voice_activity
    
    try:
        if is_recording:
            return False
            
        is_recording = True
        recording_data = []
        last_voice_activity = time.time()
        
        def callback(indata, frames, time_info, status):
            if status:
                print(f"Audio stream status: {status}")
            if is_recording and indata is not None:
                audio_chunk = indata.copy()
                recording_data.append(audio_chunk)
                
                if has_voice_activity(audio_chunk):
                    global last_voice_activity
                    last_voice_activity = time.time()
        
        stream = sd.InputStream(
            samplerate=sample_rate,
            channels=1,
            dtype='float32',
            callback=callback,
            blocksize=1024
        )
        stream.start()
        print("Server recording started")
        return True
        
    except Exception as e:
        print(f"Error starting server recording: {e}")
        return False

def stop_server_recording():
    """Stop server-side recording and return audio data as bytes"""
    global is_recording, recording_data, stream, last_voice_activity
    
    try:
        if not is_recording:
            return None
            
        is_recording = False
        
        if stream:
            stream.stop()
            stream.close()
            stream = None
        
        if recording_data:
            audio_array = np.concatenate(recording_data, axis=0)
            
            total_duration = len(audio_array) / sample_rate
            silence_duration = time.time() - last_voice_activity
            
            if silence_duration > min(2.0, total_duration * 0.8):
                print("No speech detected in recording")
                return "no_speech"
            
            # Convert to WAV bytes
            wav_io = io.BytesIO()
            sf.write(wav_io, audio_array.flatten(), sample_rate, format='WAV')
            wav_io.seek(0)
            return wav_io.read()
        
        return None
        
    except Exception as e:
        print(f"Error stopping server recording: {e}")
        return None

def convert_audio_bytes_to_wav(audio_bytes, original_filename):
    """Convert audio bytes to WAV format for processing"""
    try:
        # Save to temp bytes IO
        input_io = io.BytesIO(audio_bytes)
        
        # Load audio with pydub
        audio = AudioSegment.from_file(input_io)
        
        # Convert to mono and 16kHz
        if audio.channels > 1:
            audio = audio.set_channels(1)
        if audio.frame_rate != 16000:
            audio = audio.set_frame_rate(16000)
        
        # Export to WAV bytes
        wav_io = io.BytesIO()
        audio.export(wav_io, format="wav")
        wav_io.seek(0)
        
        return wav_io.read()
        
    except Exception as e:
        print(f"Audio conversion error: {e}")
        return None

def transcribe_pashto_audio_bytes(audio_bytes):
    """Transcribe Pashto audio bytes to text using Pashto ASR v6"""
    try:
        print(f"Transcribing audio from bytes...")
        
        if audio_bytes is None or len(audio_bytes) < 1000:
            print("Empty or silent audio detected")
            return "Empty or silent audio"
        
        # Load audio from bytes
        audio_io = io.BytesIO(audio_bytes)
        audio = AudioSegment.from_file(audio_io)
        
        # Convert to mono and 16kHz if needed
        if audio.channels > 1:
            audio = audio.set_channels(1)
        if audio.frame_rate != 16000:
            audio = audio.set_frame_rate(16000)
        
        # Convert to numpy array
        audio_array = np.array(audio.get_array_of_samples(), dtype=np.float32)
        
        # Normalize to [-1, 1]
        if audio_array.size > 0:
            if audio_array.dtype == np.int16:
                audio_array = audio_array / 32768.0
        else:
            return "Empty audio file"
        
        # Use Pashto ASR v6 for transcription
        if asr_processor is None or asr_model is None:
            return "ASR model not available"
        
        # Process audio with ASR model
        inputs = asr_processor(audio_array, sampling_rate=16000, return_tensors="pt")
        
        # Move to GPU if available
        if torch.cuda.is_available():
            inputs = {k: v.to('cuda') for k, v in inputs.items()}
        
        # Get transcription
        with torch.no_grad():
            logits = asr_model(**inputs).logits
        
        # Decode transcription
        predicted_ids = torch.argmax(logits, dim=-1)
        transcription = asr_processor.batch_decode(predicted_ids)[0]
        
        if transcription and len(transcription.strip()) > 0:
            print(f"✓ ASR v6 transcription: {transcription[:100]}...")
            return transcription.strip()
        else:
            return "Transcription failed - please try again"
        
    except Exception as e:
        print(f"Transcription error: {e}")
        import traceback
        traceback.print_exc()
        return "Error in transcription process"

def translate_pashto_to_english(pashto_text):
    """Translate Pashto text to English using Ollama translategemma:4b"""
    try:
        if not pashto_text or pashto_text == "Empty or silent audio" or pashto_text.startswith("Transcription failed") or pashto_text.startswith("Error"):
            return "Please ask your question clearly in Pashto"
        
        print(f"Translating Pashto text to English using translategemma:4b...")
        print(f"Text: {pashto_text[:100]}...")
        
        prompt = f"Translate this Pashto text to English:\n{pashto_text}\n\nEnglish Translation:"
        
        try:
            result = subprocess.run(
                ["ollama", "run", "translategemma:4b"],
                input=prompt,
                text=True,
                capture_output=True,
                timeout=30
            )
            
            translation = result.stdout.strip()
            
            if translation:
                # Clean up the translation
                lines = translation.split('\n')
                clean_lines = []
                for line in lines:
                    line = line.strip()
                    if line and not line.lower().startswith('translate') and not line.lower().startswith('pashto'):
                        clean_lines.append(line)
                
                translation = ' '.join(clean_lines).strip()
                
                # Remove "Translation:" prefix if present
                if translation.lower().startswith('translation:'):
                    translation = translation[12:].strip()
                if translation.lower().startswith('english translation:'):
                    translation = translation[19:].strip()
                
                # Ensure proper punctuation
                if translation and not translation.endswith(('.', '!', '?')):
                    translation = translation + '.'
                
                print(f"✓ Translation: {translation[:100]}...")
                return translation
            else:
                print("Empty translation from Ollama")
                return "Translation not available"
            
        except subprocess.TimeoutExpired:
            print("✗ Translation timeout")
            return "Translation timeout - please try again"
        except FileNotFoundError:
            print("✗ Ollama not found")
            print("Install Ollama from: https://ollama.com")
            print("Then run: ollama pull translategemma:4b")
            return "Translation service not available"
        except Exception as e:
            print(f"✗ Ollama error: {e}")
            return "Translation failed - please try again"
        
    except Exception as e:
        print(f"✗ Translation error: {e}")
        return "Please ask your question clearly in Pashto"

def generate_answer_with_gemini(pashto_question, english_question):
    """Generate Pashto answer using Gemini 2.5 Flash, then translate it to English using Ollama"""
    try:
        # Check if transcription was successful
        if not pashto_question or pashto_question == "Empty or silent audio" or pashto_question.startswith("Transcription failed") or pashto_question.startswith("Error"):
            return {
                'pashto_answer': "مهرباني وکړئ په واضح ډول پښتو کې خپله پوښتنه ووايه. زه ستاسو د پوښتنې ځواب درکولی شم.",
                'english_answer': "Please ask your question clearly in Pashto. I can answer your question."
            }
        
        print(f"Generating answer for: {pashto_question[:100]}...")
        
        # Check question length
        cleaned_question = pashto_question.strip()
        if len(cleaned_question.split()) < 2:
            return {
                'pashto_answer': "ستاسو پوښتنه ډيره لنډه ده. مهرباني وکړئ نور تفصيل وړاندې کړئ.",
                'english_answer': "Your question is too short. Please provide more details."
            }
        
        # Try Google Gemini API
        api_key = os.environ.get('GOOGLE_API_KEY')
        if not api_key:
            print("✗ Google API key not found")
            return {
                'pashto_answer': "زه اوس مهال د ځواب ورکولو توان نه لرم. مهرباني وکړئ لږ وروسته بیا هڅه وکړئ.",
                'english_answer': "I am currently unable to provide answers. Please try again later."
            }
        
        try:
            # Use google.generativeai (standard package)
            import google.generativeai as genai
            
            # Configure Gemini
            genai.configure(api_key=api_key)
            
            # Create the model
            model = genai.GenerativeModel('gemini-2.5-flash')
            
            # Create optimized prompt for answer generation
            prompt = f"""
            You are a helpful AI assistant that answers questions in Pashto.
            
            QUESTION IN PASHTO: {pashto_question}
            QUESTION IN ENGLISH: {english_question}
            
            TASK: Provide a helpful answer with these EXACT requirements:
            
            1. Answer in CLEAR, SIMPLE Pashto (2-3 sentences max)
            2. Do NOT repeat the question
            3. Do NOT include "Question:" or "Answer:" labels
            4. Do NOT include any explanations about the format
            5. Just provide the answer directly in Pashto
            
            EXAMPLE FORMAT:
            په دې اړه معلومات وړاندې کول چې مصنوعي ذهانت څه شی دی او څنګه کار کوي. دا د کمپیوټر پروګرامونو یوه څانګه ده چې د انساني ذهن کار کوي.
            
            Now provide the answer for the question above.
            """
            
            # Try up to 3 times if server is busy
            for attempt in range(3):
                try:
                    response = model.generate_content(prompt)
                    
                    if response and response.text:
                        pashto_answer = response.text.strip()
                        
                        # Clean up the answer
                        pashto_answer = clean_answer_text(pashto_answer)
                        
                        # Ensure answer is not empty
                        if not pashto_answer or len(pashto_answer.strip()) < 5:
                            pashto_answer = "زه ستاسو د پوښتنې په اړه فکر کوم. د ستاسو د پوښتنې ځواب دا دی: زه هڅه کوم چې په پښتو کې ګټور معلومات تاسو ته وړاندې کړم."
                        
                        # Now translate the Pashto answer to English using Ollama
                        print("Translating Pashto answer to English...")
                        english_answer = translate_pashto_to_english(pashto_answer)
                        
                        print(f"✓ Gemini answer generated")
                        print(f"  Pashto Answer: {pashto_answer[:100]}...")
                        print(f"  English Answer: {english_answer[:100]}...")
                        
                        return {
                            'pashto_answer': pashto_answer,
                            'english_answer': english_answer
                        }
                    
                    break  # Success, exit retry loop
                    
                except Exception as e:
                    wait = 2 ** attempt
                    print(f"Gemini attempt {attempt + 1} failed: {e} - retrying in {wait} sec...")
                    time.sleep(wait)
            
            print("✗ Gemini returned empty response after retries")
            return {
                'pashto_answer': "زه اوس مهال د ځواب ورکولو توان نه لرم. مهرباني وکړئ لږ وروسته بیا هڅه وکړئ.",
                'english_answer': "I am currently unable to provide answers. Please try again later."
            }
                
        except Exception as e:
            print(f"✗ Gemini API error: {e}")
            import traceback
            traceback.print_exc()
            return {
                'pashto_answer': "زه اوس مهال د ځواب ورکولو توان نه لرم. مهرباني وکړئ لږ وروسته بیا هڅه وکړئ.",
                'english_answer': "I am currently unable to provide answers. Please try again later."
            }
        
    except Exception as e:
        print(f"✗ Answer generation error: {e}")
        import traceback
        traceback.print_exc()
        return {
            'pashto_answer': "زه اوس مهال د ځواب ورکولو توان نه لرم. مهرباني وکړئ لږ وروسته بیا هڅه وکړئ.",
            'english_answer': "I am currently unable to provide answers. Please try again later."
        }

def clean_answer_text(text):
    """Clean answer text"""
    if not text:
        return ""
    
    # Remove markdown formatting
    text = text.replace('**', '').replace('*', '').replace('#', '').replace('```', '').replace('`', '')
    
    # Remove common labels and prefixes
    labels_to_remove = [
        'Question:', 'Answer:', 'PASHTO_ANSWER:', 'ENGLISH_ANSWER:', 
        'پوښتنه:', 'ځواب:', 'Pashto Answer:', 'English Answer:',
        'پښتو ځواب:', 'انګلیسي ځواب:', 'Translation:', 'ترجمه:',
        'Pashto:', 'English:', 'پښتو:', 'انګلیسي:'
    ]
    
    for label in labels_to_remove:
        if text.startswith(label):
            text = text[len(label):].strip()
    
    # Clean whitespace
    text = ' '.join(text.split())
    
    # Ensure proper punctuation
    if text and not text.endswith(('.', '!', '؟', '?')):
        text = text + '.'
    
    return text.strip()

def generate_pashto_tts(text, voice_id="v_8eelc901"):
    """Convert Pashto text to speech using UpliftAI TTS API - Returns audio bytes"""
    try:
        if not text or text == "Not available":
            return None
        
        print(f"Generating TTS audio using UpliftAI")
        
        cleaned_text = clean_text_for_pashto_tts(text)
        
        if not cleaned_text or len(cleaned_text.strip()) < 2:
            return None
        
        # UpliftAI TTS API call
        headers = {
            "Authorization": f"Bearer {UPLIFT_AI_API_KEY}",
            "Content-Type": "application/json"
        }
        
        data = {
            "voiceId": voice_id,
            "text": cleaned_text,
            "outputFormat": UPLIFT_AI_OUTPUT_FORMAT
        }
        
        response = requests.post(UPLIFT_AI_TTS_URL, json=data, headers=headers, timeout=30)
        
        if response.status_code == 200:
            # Get audio duration from header if available
            audio_duration = response.headers.get('x-uplift-ai-audio-duration')
            print(f"UpliftAI audio duration: {audio_duration} ms")
            print(f"✓ UpliftAI TTS audio generated")
            return response.content  # Return audio bytes
        else:
            print(f"✗ UpliftAI TTS API error: {response.status_code}")
            print(f"Error details: {response.text}")
            return None
            
    except requests.exceptions.Timeout:
        print("✗ UpliftAI TTS timeout")
        return None
    except requests.exceptions.ConnectionError:
        print("✗ UpliftAI TTS connection error")
        return None
    except Exception as e:
        print(f"✗ UpliftAI TTS Error: {e}")
        return None

def create_silent_audio():
    """Create silent audio data as fallback"""
    try:
        sample_rate = 24000
        duration = 1.5
        frames = int(sample_rate * duration)
        
        wav_io = io.BytesIO()
        with wave.open(wav_io, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(b'\x00' * frames * 2)
        
        wav_io.seek(0)
        return wav_io.read()
    except Exception as e:
        print(f"Failed to create silent audio: {e}")
        return None

def clean_text_for_pashto_tts(text):
    """Clean Pashto text for better TTS pronunciation"""
    if not text:
        return ""
    
    text = ' '.join(text.split())
    text = text.replace('؟', '؟ ')
    text = text.replace('!', '! ')
    text = text.replace('.', '. ')
    text = text.replace('،', '، ')
    
    text = text.replace('"', '')
    text = text.replace("'", '')
    text = text.replace('\n', ' ')
    text = text.replace('\r', ' ')
    text = text.replace('  ', ' ')
    
    if len(text) > 500:
        text = text[:500] + "..."
    
    return text.strip()

def optimize_text_for_pashto_answer(text):
    """Optimize Pashto answer text for better TTS"""
    if not text:
        return text
    
    if not text.endswith(('.', '!', '؟')):
        text = text + '.'
    
    text = clean_text_for_pashto_tts(text)
    
    if len(text) > 100:
        sentences = re.split(r'[.!؟]', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        if len(sentences) > 1:
            text = '، '.join(sentences[:-1]) + '، ' + sentences[-1] + '.'
    
    return text

def play_audio_in_background(file_path):
    """Play audio file in background"""
    try:
        if not pygame.mixer.get_init():
            pygame.mixer.init(frequency=22050, size=-16, channels=1, buffer=4096)
        
        # Handle both MP3 and WAV
        if file_path.endswith('.mp3'):
            # Load MP3 directly
            pygame.mixer.music.load(file_path)
        else:
            # Try loading as is
            pygame.mixer.music.load(file_path)
        
        pygame.mixer.music.set_volume(1.0)
        pygame.mixer.music.play()
        
        while pygame.mixer.music.get_busy():
            time.sleep(0.1)
        
        return True
    except Exception as e:
        print(f"Playback error: {e}")
        return False

def process_audio_bytes(audio_bytes, source_type):
    """Process audio bytes through the complete pipeline - Store audio in memory"""
    global audio_store, latest_results
    
    data = {
        'pashto_question': '',
        'english_question': '',
        'pashto_answer': '',
        'english_answer': ''
    }
    
    try:
        # Step 1: Transcribe using Pashto ASR v6
        print("\n" + "=" * 50)
        print("Step 1: Transcribing audio with Pashto ASR v6...")
        pashto_question = transcribe_pashto_audio_bytes(audio_bytes)
        print(f"Transcription: {pashto_question[:100]}...")
        
        # Handle empty/silent audio case
        if pashto_question == "Empty or silent audio":
            data['pashto_question'] = "مهرباني وکړئ په واضح ډول پښتو کې خپله پوښتنه ووايه"
            data['english_question'] = "Please ask your question clearly in Pashto"
            data['pashto_answer'] = "زه ستاسو د پوښتنې اوریدلو لپاره دلته یم. مهرباني وکړئ خپله پوښتنه په واضح ډول ووايئ"
            data['english_answer'] = "I am here to listen to your question. Please ask your question clearly"
            
            # Store in memory
            latest_results = data
            audio_store['pashto_question'] = create_silent_audio()
            audio_store['pashto_answer'] = create_silent_audio()
            
            return data
        
        data['pashto_question'] = pashto_question
        
        # Handle transcription failures
        if pashto_question.startswith("Transcription failed") or pashto_question.startswith("Error") or pashto_question.startswith("ASR"):
            print("✗ Transcription failed, using custom message")
            data['pashto_question'] = "مهرباني وکړئ په واضح ډول پښتو کې خپله پوښتنه ووايه"
            data['english_question'] = "Please ask your question clearly in Pashto"
            data['pashto_answer'] = "زه ستاسو د پوښتنې اوریدلو لپاره دلته یم. مهرباني وکړئ خپله پوښتنه په واضح ډول ووايئ"
            data['english_answer'] = "I am here to listen to your question. Please ask your question clearly"
            
            # Store in memory
            latest_results = data
            audio_store['pashto_question'] = create_silent_audio()
            audio_store['pashto_answer'] = create_silent_audio()
            
            return data
        
        # Step 2: Translate question using Ollama translategemma:4b
        print("\nStep 2: Translating question with translategemma:4b...")
        english_question = translate_pashto_to_english(pashto_question)
        data['english_question'] = english_question
        print(f"Translation: {english_question[:100]}...")
        
        # Step 3: Generate Pashto answer using Gemini 2.5 Flash, then translate to English
        print("\nStep 3: Generating answer with Gemini 2.5 Flash...")
        answers = generate_answer_with_gemini(pashto_question, english_question)
        data['pashto_answer'] = answers['pashto_answer']
        data['english_answer'] = answers['english_answer']
        
        # Optimize text for TTS
        if data['pashto_question']:
            data['pashto_question'] = optimize_text_for_pashto_answer(data['pashto_question'])
        
        if data['pashto_answer']:
            data['pashto_answer'] = optimize_text_for_pashto_answer(data['pashto_answer'])
        
        # Step 4: Generate TTS audio
        print("\nStep 4: Generating TTS audio...")
        voice_name = session.get('voice', 'v_8eelc901')
        
        # Generate audio and store in memory
        question_audio = generate_pashto_tts(data['pashto_question'], voice_name)
        answer_audio = generate_pashto_tts(data['pashto_answer'], voice_name)
        
        audio_store['pashto_question'] = question_audio if question_audio else create_silent_audio()
        audio_store['pashto_answer'] = answer_audio if answer_audio else create_silent_audio()
        
        print("\n" + "=" * 50)
        print("✓ All processing steps completed")
        print(f"Pashto Question: {pashto_question[:50]}...")
        print(f"English Question: {english_question[:50]}...")
        print(f"Pashto Answer: {answers['pashto_answer'][:50]}...")
        print(f"English Answer: {answers['english_answer'][:50]}...")
        print("=" * 50 + "\n")
        
        # Store results in memory
        latest_results = data
        
    except Exception as e:
        print(f"✗ Processing error: {e}")
        import traceback
        traceback.print_exc()
        
        data['pashto_question'] = "مهرباني وکړئ په واضح ډول پښتو کې خپله پوښتنه ووايه"
        data['english_question'] = "Please ask your question clearly in Pashto"
        data['pashto_answer'] = "زه ستاسو د پوښتنې اوریدلو لپاره دلته یم. مهرباني وکړئ خپله پوښتنه په واضح ډول ووايئ"
        data['english_answer'] = "I am here to listen to your question. Please ask your question clearly"
        
        latest_results = data
        audio_store['pashto_question'] = create_silent_audio()
        audio_store['pashto_answer'] = create_silent_audio()
    
    return data

# -----------------------------
# ROUTES
# -----------------------------

@app.route('/')
def index():
    """Render the main page"""
    session.clear()
    return render_template('index.html', voices=AVAILABLE_VOICES)

@app.route('/start-recording', methods=['POST'])
def start_recording():
    """Start server-side audio recording"""
    try:
        success = start_server_recording()
        if success:
            return jsonify({
                'success': True,
                'message': 'Recording started on server'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Could not start recording. Make sure microphone is connected.'
            })
    except Exception as e:
        print(f"Start recording error: {e}")
        return jsonify({'error': f'Error starting recording: {str(e)}'}), 500

@app.route('/stop-recording', methods=['POST'])
def stop_recording():
    """Stop server-side recording and process audio"""
    try:
        voice = request.json.get('voice', 'v_8eelc901') if request.json else 'v_8eelc901'
        
        audio_bytes = stop_server_recording()
        
        if audio_bytes is None:
            return jsonify({'error': 'No recording data available'}), 400
        
        if audio_bytes == "no_speech":
            return jsonify({
                'success': False,
                'error': 'no_speech',
                'message': 'No speech detected. Please speak in Pashto.'
            }), 400
        
        # Process the audio directly
        global is_processing
        is_processing = True
        
        try:
            data = process_audio_bytes(audio_bytes, 'recording')
            is_processing = False
            
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            
            return jsonify({
                'success': True,
                'data': data,
                'timestamp': timestamp,
                'source_type': 'recording',
                'message': 'Recording processed successfully'
            })
        except Exception as e:
            is_processing = False
            return jsonify({'error': f'Error processing: {str(e)}'}), 500
        
    except Exception as e:
        print(f"Stop recording error: {e}")
        return jsonify({'error': f'Error stopping recording: {str(e)}'}), 500

@app.route('/upload-recording', methods=['POST'])
def upload_recording():
    """Handle recording upload from client-side MediaRecorder"""
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        file = request.files['audio']
        voice = request.form.get('voice', 'v_8eelc901')
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        webm_data = file.read()
        
        if len(webm_data) < 1000:
            data = {
                'pashto_question': "مهرباني وکړئ په واضح ډول پښتو کې خپله پوښتنه ووايه",
                'english_question': "Please ask your question clearly in Pashto",
                'pashto_answer': "زه ستاسو د پوښتنې اوریدلو لپاره دلته یم. مهرباني وکړئ خپله پوښتنه په واضح ډول ووايئ",
                'english_answer': "I am here to listen to your question. Please ask your question clearly"
            }
            
            # Store in memory
            global audio_store, latest_results
            latest_results = data
            audio_store['pashto_question'] = create_silent_audio()
            audio_store['pashto_answer'] = create_silent_audio()
            
            return jsonify({
                'success': True,
                'data': data,
                'timestamp': timestamp,
                'source_type': 'recording',
                'message': 'Empty audio detected - please record a clear question'
            })
        
        # Convert webm to wav bytes
        wav_bytes = convert_audio_bytes_to_wav(webm_data, file.filename)
        
        if wav_bytes is None:
            return jsonify({'error': 'Failed to process recording'}), 500
        
        # Process the audio
        global is_processing
        is_processing = True
        
        try:
            data = process_audio_bytes(wav_bytes, 'recording')
            is_processing = False
            
            return jsonify({
                'success': True,
                'data': data,
                'timestamp': timestamp,
                'source_type': 'recording',
                'message': 'Recording processed successfully'
            })
        except Exception as e:
            is_processing = False
            return jsonify({'error': f'Error processing: {str(e)}'}), 500
        
    except Exception as e:
        print(f"Upload recording error: {e}")
        return jsonify({'error': f'Error uploading recording: {str(e)}'}), 500

@app.route('/upload-audio', methods=['POST'])
def upload_audio():
    """Handle audio file upload - process directly without saving"""
    try:
        if 'audio_file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['audio_file']
        voice = request.form.get('voice', 'v_8eelc901')
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if file:
            # Read file bytes directly
            audio_bytes = file.read()
            
            if len(audio_bytes) < 1000:
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                data = {
                    'pashto_question': "مهرباني وکړئ په واضح ډول پښتو کې خپله پوښتنه ووايه",
                    'english_question': "Please ask your question clearly in Pashto",
                    'pashto_answer': "زه ستاسو د پوښتنې اوریدلو لپاره دلته یم. مهرباني وکړئ خپله پوښتنه په واضح ډول ووايئ",
                    'english_answer': "I am here to listen to your question. Please ask your question clearly"
                }
                
                # Store in memory
                global audio_store, latest_results
                latest_results = data
                audio_store['pashto_question'] = create_silent_audio()
                audio_store['pashto_answer'] = create_silent_audio()
                
                return jsonify({
                    'success': True,
                    'data': data,
                    'timestamp': timestamp,
                    'source_type': 'upload',
                    'message': 'Empty audio detected - please upload a valid audio file'
                })
            
            # Convert to WAV if needed
            if not file.filename.lower().endswith('.wav'):
                wav_bytes = convert_audio_bytes_to_wav(audio_bytes, file.filename)
                if wav_bytes:
                    audio_bytes = wav_bytes
            
            # Process the audio directly from bytes
            global is_processing
            is_processing = True
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            
            try:
                data = process_audio_bytes(audio_bytes, 'upload')
                is_processing = False
                
                return jsonify({
                    'success': True,
                    'data': data,
                    'timestamp': timestamp,
                    'source_type': 'upload',
                    'message': 'File processed successfully'
                })
            except Exception as e:
                is_processing = False
                return jsonify({'error': f'Error processing: {str(e)}'}), 500
        
        return jsonify({'error': 'File upload failed'}), 400
        
    except Exception as e:
        print(f"Upload audio error: {e}")
        return jsonify({'error': f'Error uploading audio: {str(e)}'}), 500

@app.route('/process-recording', methods=['POST'])
def process_recording():
    """Process recording - Use in-memory storage"""
    global is_processing, audio_store, latest_results
    
    if is_processing:
        return jsonify({
            'success': False,
            'error': 'Processing is already in progress. Please wait or stop the current process.'
        }), 400
    
    # This endpoint now just returns the latest results
    if latest_results:
        return jsonify({
            'success': True,
            'data': latest_results,
            'timestamp': datetime.now().strftime('%Y%m%d_%H%M%S'),
            'source_type': 'recording',
            'message': 'Results retrieved'
        })
    
    return jsonify({'error': 'No results found'}), 400

@app.route('/process-audio', methods=['POST'])
def process_audio():
    """Process uploaded audio file - Use in-memory storage"""
    global is_processing, audio_store, latest_results
    
    if is_processing:
        return jsonify({
            'success': False,
            'error': 'Processing is already in progress. Please wait or stop the current process.'
        }), 400
    
    # This endpoint now just returns the latest results
    if latest_results:
        return jsonify({
            'success': True,
            'data': latest_results,
            'timestamp': datetime.now().strftime('%Y%m%d_%H%M%S'),
            'source_type': 'upload',
            'message': 'Results retrieved'
        })
    
    return jsonify({'error': 'No results found'}), 400

@app.route('/play-audio/<audio_type>')
def play_audio(audio_type):
    """Play audio from memory - Stream from memory"""
    global audio_store
    
    if audio_type == 'pashto_question' or audio_type == 'question':
        audio_data = audio_store.get('pashto_question')
    elif audio_type == 'pashto_answer' or audio_type == 'answer':
        audio_data = audio_store.get('pashto_answer')
    else:
        return jsonify({'error': 'Invalid audio type'}), 400
    
    if audio_data is None:
        audio_data = create_silent_audio()
        if audio_data is None:
            return jsonify({'error': 'No audio available'}), 404
    
    return Response(
        audio_data,
        mimetype='audio/mpeg',
        headers={
            'Content-Disposition': 'inline',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    )

@app.route('/download/<file_type>')
def download_file(file_type):
    """Download files - DISABLED"""
    return jsonify({'error': 'File download is disabled - audio is streamed directly'}), 400

@app.route('/regenerate-audio/<audio_type>', methods=['POST'])
def regenerate_audio(audio_type):
    """Regenerate audio with current settings - Store in memory"""
    global audio_store, latest_results
    
    if not latest_results:
        return jsonify({'error': 'No translation data found'}), 404
    
    voice_name = session.get('voice', 'v_8eelc901')
    
    try:
        if audio_type == 'pashto_answer' or audio_type == 'all' or audio_type == 'answer':
            if latest_results.get('pashto_answer'):
                answer_audio = generate_pashto_tts(latest_results['pashto_answer'], voice_name)
                if answer_audio:
                    audio_store['pashto_answer'] = answer_audio
        
        if audio_type == 'pashto_question' or audio_type == 'all' or audio_type == 'question':
            if latest_results.get('pashto_question'):
                question_audio = generate_pashto_tts(latest_results['pashto_question'], voice_name)
                if question_audio:
                    audio_store['pashto_question'] = question_audio
        
        return jsonify({
            'success': True,
            'message': 'Audio regenerated successfully'
        })
        
    except Exception as e:
        return jsonify({'error': f'Error regenerating audio: {str(e)}'}), 500

@app.route('/replace-audio', methods=['POST'])
def replace_audio():
    """Replace audio file and process again"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        voice = request.form.get('voice', 'v_8eelc901')
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read file bytes directly
        audio_bytes = file.read()
        
        if len(audio_bytes) < 1000:
            return jsonify({'error': 'File is too small or empty'}), 400
        
        # Convert to WAV if needed
        if not file.filename.lower().endswith('.wav'):
            wav_bytes = convert_audio_bytes_to_wav(audio_bytes, file.filename)
            if wav_bytes:
                audio_bytes = wav_bytes
        
        # Process the audio directly
        global is_processing
        is_processing = True
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        try:
            data = process_audio_bytes(audio_bytes, 'upload')
            is_processing = False
            
            return jsonify({
                'success': True,
                'data': data,
                'timestamp': timestamp,
                'source_type': 'upload',
                'message': 'Audio replaced and processed successfully'
            })
        except Exception as e:
            is_processing = False
            return jsonify({'error': f'Error processing: {str(e)}'}), 500
        
    except Exception as e:
        print(f"Replace audio error: {e}")
        return jsonify({'error': f'Error replacing audio: {str(e)}'}), 500

@app.route('/stop-processing', methods=['POST'])
def stop_processing():
    """Stop current audio processing"""
    global is_processing
    
    if is_processing:
        is_processing = False
        return jsonify({
            'success': True,
            'message': 'Processing stopped. You can now upload new audio or record again.'
        })
    else:
        return jsonify({
            'success': False,
            'error': 'No processing in progress'
        })

@app.route('/clear-session', methods=['POST'])
def clear_session():
    """Clear session data"""
    global is_processing, audio_store, latest_results
    
    try:
        is_processing = False
        audio_store = {}
        latest_results = {}
        
        session.clear()
        return jsonify({'success': True, 'message': 'Session cleared'})
        
    except Exception as e:
        print(f"Clear session error: {e}")
        return jsonify({'error': f'Error clearing session: {str(e)}'}), 500

@app.route('/get-processing-status', methods=['GET'])
def get_processing_status():
    """Get current processing status"""
    return jsonify({
        'is_processing': is_processing,
        'is_recording': is_recording
    })

@app.route('/get-results', methods=['GET'])
def get_results():
    """Get latest results from memory"""
    global latest_results, audio_store
    
    return jsonify({
        'success': True,
        'data': latest_results,
        'has_question_audio': audio_store.get('pashto_question') is not None,
        'has_answer_audio': audio_store.get('pashto_answer') is not None,
        'timestamp': datetime.now().strftime('%Y%m%d_%H%M%S')
    })

if __name__ == '__main__':
    try:
        pygame.mixer.init()
        print("✓ Pygame mixer initialized")
    except Exception as e:
        print(f"✗ Pygame mixer init failed: {e}")
    
    print("=" * 60)
    print("PASHTO-ENGLISH AUDIO TRANSLATOR")
    print("=" * 60)
    print(f"ASR Model: Pashto ASR v6 (ihanif/pashto-asr-v6)")
    print(f"Translation Model: Ollama translategemma:4b")
    print(f"Answer Model: Google Gemini 2.5 Flash")
    print(f"TTS Engine: UpliftAI TTS")
    print(f"TTS Voice ID: {UPLIFT_AI_VOICE_ID}")
    print("=" * 60)
    print("✓ NO FOLDERS CREATED - All processing in memory")
    print("✓ Files are processed directly without saving")
    print("=" * 60)
    
    if not os.environ.get('GOOGLE_API_KEY'):
        print("⚠ WARNING: GOOGLE_API_KEY not set in environment variables")
        print("Gemini answer generation will fail.")
    else:
        print("✓ Google API key found")
    
    if not UPLIFT_AI_API_KEY:
        print("⚠ WARNING: UpliftAI API key not set")
        print("TTS will be unavailable.")
    else:
        print("✓ UpliftAI API key found")
    
    try:
        result = subprocess.run(["ollama", "list"], capture_output=True, text=True)
        if "translategemma" not in result.stdout:
            print("⚠ WARNING: translategemma model not found in Ollama")
            print("Run: ollama pull translategemma:4b")
        else:
            print("✓ Ollama translategemma model found")
    except:
        print("⚠ WARNING: Ollama not found or not running")
        print("Install Ollama from: https://ollama.com")
        print("Then run: ollama pull translategemma:4b")
    
    print("=" * 60)
    print("Starting server on http://127.0.0.1:8660")
    print("Press Ctrl+C to stop")
    print("=" * 60)
    
    app.run(debug=False, host='127.0.0.1', port=8660)