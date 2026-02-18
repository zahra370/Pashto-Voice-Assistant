$(document).ready(function() {
    // Audio player instances
    let questionAudio = document.getElementById('questionAudio');
    let answerAudio = document.getElementById('answerAudio');
    
    // Current state
    let currentPlayer = null;
    let currentTextType = null;
    let wordIndex = 0;
    let isPlaying = false;
    let currentVoice = 'ps';
    let currentTimestamp = '';
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingTimer = null;
    let recordingSeconds = 0;
    let processingTimer = null;
    let processingStartTime = null;
    let currentAudioType = null;
    let isProcessing = false;
    let currentProcessing = false;
    let audioStream = null;
    let currentSourceType = '';
    
    // Initialize
    initializeApp();
    
    // -----------------------------
    // INITIALIZATION FUNCTIONS
    // -----------------------------
    
    function initializeApp() {
        // Initialize tooltips
        $('[data-bs-toggle="tooltip"]').tooltip();
        
        // Initialize visualizer
        initializeVisualizer();
        
        // Initialize audio players
        initializeAudioPlayers();
        
        // Check processing status periodically
        setInterval(checkProcessingStatus, 3000);
        
        // Set up microphone permission check
        setupMicrophonePermission();
    }
    
    function setupMicrophonePermission() {
        // Check microphone permission only when needed
        updateMicrophoneStatusDisplay();
        
        // Listen for permission request button
        $('#requestPermissionBtn').on('click', function() {
            requestMicrophonePermission();
        });
    }
    
    function updateMicrophoneStatusDisplay() {
        const statusElement = $('#microphoneStatusText');
        const permissionStatusElement = $('#permissionStatus');
        
        if (!statusElement.length) return;
        
        // Check if permission API is supported
        if (!navigator.permissions || !navigator.permissions.query) {
            statusElement.text('Click "Allow Microphone Access" to enable recording');
            if (permissionStatusElement.length) {
                permissionStatusElement.html('<i class="fas fa-info-circle me-2"></i> Click "Allow Microphone Access" to request permission');
            }
            return;
        }
        
        // Check current permission status
        navigator.permissions.query({ name: 'microphone' })
            .then(permissionStatus => {
                updatePermissionUI(permissionStatus.state);
                
                // Listen for permission changes
                permissionStatus.onchange = function() {
                    updatePermissionUI(this.state);
                };
            })
            .catch(error => {
                console.error('Permission query error:', error);
                statusElement.text('Click "Allow Microphone Access" to enable recording');
                if (permissionStatusElement.length) {
                    permissionStatusElement.html('<i class="fas fa-info-circle me-2"></i> Click "Allow Microphone Access" to request permission');
                }
            });
    }
    
    function updatePermissionUI(state) {
        const statusElement = $('#microphoneStatusText');
        const permissionStatusElement = $('#permissionStatus');
        const requestBtn = $('#requestPermissionBtn');
        
        if (!statusElement.length) return;
        
        switch(state) {
            case 'granted':
                statusElement.html('<span class="text-success"><i class="fas fa-check-circle me-1"></i>Microphone access granted</span>');
                if (permissionStatusElement.length) {
                    permissionStatusElement.html('<i class="fas fa-check-circle me-2 text-success"></i> Microphone permission granted!');
                }
                if (requestBtn.length) {
                    requestBtn.html('<i class="fas fa-check-circle me-2"></i>Permission Granted')
                        .prop('disabled', false)
                        .removeClass('btn-primary')
                        .addClass('btn-success');
                }
                
                // Hide permission card, show recording interface
                setTimeout(() => {
                    $('#microphonePermissionCard').addClass('d-none');
                    $('#recordingInterface').removeClass('d-none');
                }, 500);
                break;
                
            case 'denied':
                statusElement.html('<span class="text-danger"><i class="fas fa-times-circle me-1"></i>Microphone access denied. Allow in browser settings.</span>');
                if (permissionStatusElement.length) {
                    permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> Microphone permission denied. Please allow in browser settings.');
                }
                if (requestBtn.length) {
                    requestBtn.html('<i class="fas fa-microphone-slash me-2"></i>Permission Denied')
                        .prop('disabled', true)
                        .removeClass('btn-primary')
                        .addClass('btn-danger');
                }
                break;
                
            default:
                statusElement.html('<span>Click "Allow Microphone Access" to enable recording</span>');
                if (permissionStatusElement.length) {
                    permissionStatusElement.html('<i class="fas fa-info-circle me-2"></i> Click "Allow Microphone Access" to request permission');
                }
                if (requestBtn.length) {
                    requestBtn.html('<i class="fas fa-microphone me-2"></i>Allow Microphone Access')
                        .prop('disabled', false)
                        .removeClass('btn-success', 'btn-danger')
                        .addClass('btn-primary');
                }
                break;
        }
    }
    
    async function requestMicrophonePermission() {
        try {
            const permissionStatusElement = $('#permissionStatus');
            const requestBtn = $('#requestPermissionBtn');
            
            if (permissionStatusElement.length) {
                permissionStatusElement.html('<i class="fas fa-spinner fa-spin me-2"></i> Requesting microphone permission...');
            }
            
            if (requestBtn.length) {
                requestBtn.html('<i class="fas fa-spinner fa-spin me-2"></i>Requesting...')
                    .prop('disabled', true);
            }
            
            // Request microphone permission
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // Stop the stream - we just needed permission
            stream.getTracks().forEach(track => track.stop());
            
            // Update status via permission API
            updateMicrophoneStatusDisplay();
            
        } catch (error) {
            console.error('Microphone permission error:', error);
            
            const permissionStatusElement = $('#permissionStatus');
            const requestBtn = $('#requestPermissionBtn');
            
            if (permissionStatusElement.length) {
                if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                    permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> Microphone permission denied. Please allow in browser settings.');
                } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                    permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> No microphone found. Please connect a microphone.');
                } else {
                    permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> Error: ' + error.message);
                }
            }
            
            if (requestBtn.length) {
                requestBtn.html('<i class="fas fa-microphone me-2"></i>Try Again')
                    .prop('disabled', false);
            }
            
            // Update status display
            updateMicrophoneStatusDisplay();
        }
    }
    
    function initializeVisualizer() {
        const visualizer = $('#visualizer');
        visualizer.empty();
        for (let i = 0; i < 8; i++) {
            visualizer.append('<div class="bar"></div>');
        }
    }
    
    function initializeAudioPlayers() {
        if (!questionAudio || !answerAudio) {
            console.error('Audio elements not found');
            return;
        }
        
        questionAudio.volume = 1.0;
        answerAudio.volume = 1.0;
        
        // Set initial volume slider values
        $('#questionVolume').val(100);
        $('#answerVolume').val(100);
        
        // Setup audio player events
        setupAudioPlayerEvents('question', questionAudio);
        setupAudioPlayerEvents('answer', answerAudio);
    }
    
    // -----------------------------
    // PROCESSING STATUS MANAGEMENT
    // -----------------------------
    
    function checkProcessingStatus() {
        if (isProcessing || currentProcessing) {
            $.ajax({
                url: '/get-processing-status',
                type: 'GET',
                success: function(response) {
                    if (response.is_processing && !currentProcessing) {
                        // Another process is running
                        showProcessingControl();
                    } else if (!response.is_processing && currentProcessing) {
                        // Our process stopped
                        hideProcessingControl();
                    }
                },
                error: function() {
                    // Silently handle errors
                }
            });
        }
    }
    
    function showProcessingControl() {
        $('#processingControlCard').removeClass('d-none');
        $('.nav-tabs .nav-link').prop('disabled', true);
        $('.btn:not(#stopProcessingBtn, #stopProgressBtn)').prop('disabled', true);
        $('#processingStatusText').text('Processing through hybrid AI pipeline...');
    }
    
    function hideProcessingControl() {
        $('#processingControlCard').addClass('d-none');
        $('.nav-tabs .nav-link').prop('disabled', false);
        $('.btn:not(#stopProcessingBtn, #stopProgressBtn)').prop('disabled', false);
        resetButtons();
    }
    
    // -----------------------------
    // RECORDING FUNCTIONS
    // -----------------------------
    
    $('#startRecordingBtn').on('click', async function() {
        try {
            // Check if processing is active
            if (isProcessing) {
                showError('Processing is active. Please stop it first or wait for it to complete.');
                return;
            }
            
            // Check microphone permission first
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            if (permissionStatus.state !== 'granted') {
                // Ask for permission
                await requestMicrophonePermission();
                return;
            }
            
            // Reset any previous recording
            if (window.recordedAudioBlob) {
                URL.revokeObjectURL(window.recordedAudioBlob);
                window.recordedAudioBlob = null;
            }
            
            // Clear previous audio chunks
            audioChunks = [];
            
            // Get microphone stream
            audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // Get available MIME types
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4',
                'audio/mpeg'
            ];
            
            let selectedMimeType = '';
            for (const mimeType of mimeTypes) {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }
            
            if (!selectedMimeType) {
                selectedMimeType = 'audio/webm';
            }
            
            console.log('Using MIME type:', selectedMimeType);
            
            // Create MediaRecorder
            mediaRecorder = new MediaRecorder(audioStream, {
                mimeType: selectedMimeType
            });
            
            mediaRecorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = async () => {
                try {
                    if (audioChunks.length === 0) {
                        showError('Recording failed: No audio data captured.');
                        resetRecording();
                        return;
                    }
                    
                    const audioBlob = new Blob(audioChunks, { 
                        type: selectedMimeType 
                    });
                    
                    if (audioBlob.size === 0) {
                        showError('Recording is empty. Please try again.');
                        resetRecording();
                        return;
                    }
                    
                    const audioUrl = URL.createObjectURL(audioBlob);
                    
                    // Show recorded audio preview
                    $('#recordedAudio').attr('src', audioUrl);
                    $('#recordingPreview').removeClass('d-none');
                    $('#playRecordingBtn').removeClass('d-none');
                    $('#reRecordBtn').removeClass('d-none');
                    $('#processRecordingBtn').prop('disabled', false);
                    $('#cancelRecordingBtn').removeClass('d-none');
                    $('#recordingInfoAlert').removeClass('d-none');
                    
                    // Store blob for later use
                    window.recordedAudioBlob = audioBlob;
                    
                    console.log('Recording saved, size:', audioBlob.size, 'bytes');
                } catch (error) {
                    console.error('Error processing recording:', error);
                    showError('Error processing recording: ' + error.message);
                    resetRecording();
                }
            };
            
            mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                showError('Recording error: ' + event.error);
                resetRecording();
            };
            
            // Start recording with smaller chunks
            mediaRecorder.start(100); // Collect data every 100ms
            
            // Start recording timer
            recordingSeconds = 0;
            clearInterval(recordingTimer);
            recordingTimer = setInterval(() => {
                recordingSeconds++;
                const minutes = Math.floor(recordingSeconds / 60);
                const seconds = recordingSeconds % 60;
                $('#recordingTimer').text(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                
                // Stop recording after 60 seconds
                if (recordingSeconds >= 60) {
                    stopRecording();
                }
            }, 1000);
            
            // Update UI
            $('#startRecordingBtn').addClass('d-none');
            $('#stopRecordingBtn').removeClass('d-none');
            $('#recordingStatus').html('<i class="fas fa-microphone text-danger"></i> <span class="ms-2">Recording...</span>');
            $('#visualizer .bar').css('animation-play-state', 'running');
            
            console.log('Recording started successfully');
            
        } catch (error) {
            console.error('Recording setup error:', error);
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                showError('Microphone permission denied. Please allow microphone access in your browser settings.');
                // Show permission card
                $('#microphonePermissionCard').removeClass('d-none');
                $('#recordingInterface').addClass('d-none');
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                showError('No microphone found. Please connect a microphone and try again.');
            } else {
                showError('Failed to access microphone: ' + error.message);
            }
            
            // Reset UI
            $('#startRecordingBtn').removeClass('d-none');
            $('#stopRecordingBtn').addClass('d-none');
            $('#recordingStatus').html('<i class="fas fa-microphone-slash text-muted"></i> <span class="ms-2">Ready to record</span>');
        }
    });
    
    $('#stopRecordingBtn').on('click', function() {
        stopRecording();
    });
    
    $('#playRecordingBtn').on('click', function() {
        const recordedAudio = document.getElementById('recordedAudio');
        if (recordedAudio) {
            if (recordedAudio.paused) {
                recordedAudio.play();
                $(this).find('i').removeClass('fa-play').addClass('fa-pause');
            } else {
                recordedAudio.pause();
                $(this).find('i').removeClass('fa-pause').addClass('fa-play');
            }
        }
    });
    
    $('#reRecordBtn').on('click', function() {
        resetRecording();
    });
    
    $('#cancelRecordingBtn').on('click', function() {
        resetRecording();
    });
    
    $('#cancelUploadBtn').on('click', function() {
        resetUpload();
    });
    
    $('#recordedAudio').on('ended', function() {
        $('#playRecordingBtn').find('i').removeClass('fa-pause').addClass('fa-play');
    });
    
    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        
        // Stop audio stream
        if (audioStream) {
            audioStream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            audioStream = null;
        }
        
        clearInterval(recordingTimer);
        
        // Update UI
        $('#startRecordingBtn').removeClass('d-none');
        $('#stopRecordingBtn').addClass('d-none');
        $('#recordingStatus').html('<i class="fas fa-check-circle text-success"></i> <span class="ms-2">Recording complete</span>');
        $('#visualizer .bar').css('animation-play-state', 'paused');
        
        console.log('Recording stopped');
    }
    
    function resetRecording() {
        // Stop recording if active
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch (e) {
                console.log('MediaRecorder already stopped');
            }
        }
        
        // Stop audio stream
        if (audioStream) {
            audioStream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            audioStream = null;
        }
        
        clearInterval(recordingTimer);
        
        // Reset UI
        $('#startRecordingBtn').removeClass('d-none');
        $('#stopRecordingBtn').addClass('d-none');
        $('#playRecordingBtn').addClass('d-none');
        $('#reRecordBtn').addClass('d-none');
        $('#recordingPreview').addClass('d-none');
        $('#recordingInfoAlert').addClass('d-none');
        $('#processRecordingBtn').prop('disabled', true);
        $('#cancelRecordingBtn').addClass('d-none');
        $('#recordingStatus').html('<i class="fas fa-microphone-slash text-muted"></i> <span class="ms-2">Ready to record</span>');
        $('#recordingTimer').text('00:00');
        $('#visualizer .bar').css('animation-play-state', 'paused');
        
        // Clear audio data
        audioChunks = [];
        if (window.recordedAudioBlob) {
            URL.revokeObjectURL(window.recordedAudioBlob);
            window.recordedAudioBlob = null;
        }
        recordingSeconds = 0;
        
        console.log('Recording reset');
    }
    
    function resetUpload() {
        $('#audioFile').val('');
        $('#cancelUploadBtn').addClass('d-none');
        $('#uploadBtn').prop('disabled', false).html('<i class="fas fa-upload me-2"></i> Upload & Process');
    }
    
    // -----------------------------
    // PROCESSING FUNCTIONS
    // -----------------------------
    
    $('#processRecordingBtn').on('click', function() {
        processRecording();
    });
    
    function processRecording() {
        if (!window.recordedAudioBlob) {
            showError('No recording found. Please record audio first.');
            return;
        }
        
        // Set processing flag
        isProcessing = true;
        currentProcessing = true;
        
        // Reset players
        resetAudioPlayers();
        
        // Reset and show progress
        resetProcessingSteps();
        $('#progressCard').removeClass('d-none');
        $('#resultsCard').addClass('d-none');
        $('#errorAlert').addClass('d-none');
        $('#statusAlert').addClass('d-none');
        $('#progressText').text('Processing Through Hybrid AI Pipeline...');
        
        // Start processing timer
        startProcessingTimer();
        
        // Update step 1
        updateProcessingStep(1, 'active', 'Uploading recording...');
        updateProgressDetail('Uploading recording to server...');
        
        // Get voice selection
        const voice = $('#recordVoiceSelect').val();
        currentVoice = voice;
        
        // Disable button
        const originalText = $('#processRecordingBtn').html();
        $('#processRecordingBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-2"></i>Processing...');
        
        // Create FormData to send audio
        const formData = new FormData();
        formData.append('audio', window.recordedAudioBlob, 'recording.webm');
        formData.append('voice', voice);
        
        // Send recording to server
        $.ajax({
            url: '/upload-recording',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                if (response.success) {
                    updateProcessingStep(1, 'completed', 'Uploaded successfully');
                    updateProcessingStep(2, 'active', 'Starting hybrid AI pipeline...');
                    updateProgressDetail('Processing through ASR → Translation → Answer Generation...');
                    
                    // Store timestamp for later use
                    currentTimestamp = response.timestamp;
                    currentSourceType = 'recording';
                    
                    // Start processing with recording endpoint
                    setTimeout(() => {
                        processRecordingAudio();
                    }, 1000);
                } else {
                    if (response.error === 'no_speech') {
                        showError('No speech detected. Please speak in Pashto during recording.');
                    } else {
                        showError(response.error || 'Upload failed');
                    }
                    resetProcessingState();
                }
            },
            error: function(xhr) {
                let error = 'Network error occurred';
                if (xhr.responseJSON && xhr.responseJSON.error) {
                    error = xhr.responseJSON.error;
                } else if (xhr.statusText) {
                    error = xhr.statusText;
                }
                showError(error);
                resetProcessingState();
            }
        });
    }
    
    function processRecordingAudio() {
        updateProcessingStep(2, 'active', 'Hybrid AI Processing...');
        updateProgressDetail('Multi-model pipeline: ASR → Ollama Translation → Gemini Answer...');
        
        $.ajax({
            url: '/process-recording',
            type: 'POST',
            success: function(response) {
                if (response.success) {
                    updateProcessingStep(2, 'completed', 'Processing complete');
                    updateProcessingStep(3, 'active', 'Finalizing results...');
                    updateProgressDetail('Finalizing processing results...');
                    
                    // Update UI with results
                    updateRecordingResults(response.data);
                    
                    // MODIFIED: Use streaming endpoints instead of download endpoints
                    setupRecordingAudioPlayers(response.timestamp);
                    
                    // Update current settings
                    currentTimestamp = response.timestamp;
                    currentSourceType = response.source_type || 'recording';
                    updateSettingsDisplay();
                    
                    // Update source type and badges
                    $('#sourceType').text('Live Recording');
                    $('#sourceIcon').removeClass().addClass('fas fa-microphone');
                    $('#currentTimestamp').text(response.timestamp);
                    
                    // Update UI for recording vs upload
                    updateUIForSourceType(currentSourceType);
                    
                    // Complete the process
                    setTimeout(() => {
                        updateProcessingStep(3, 'completed', 'Results ready');
                        updateProcessingStep(4, 'active', 'Loading audio...');
                        updateProgressDetail('Loading generated audio files...');
                        
                        setTimeout(() => {
                            updateProcessingStep(4, 'completed', 'Audio loaded successfully');
                            updateProgressDetail('Hybrid AI processing completed successfully!');
                            $('#progressBar').css('width', '100%');
                            
                            // Show success message
                            setTimeout(() => {
                                $('#progressCard').addClass('d-none');
                                $('#resultsCard').removeClass('d-none');
                                showStatus('Recording processed successfully through hybrid AI pipeline!');
                                
                                // Scroll to results
                                $('html, body').animate({
                                    scrollTop: $('#resultsCard').offset().top - 20
                                }, 500);
                                
                                // Reset processing state
                                resetProcessingState();
                            }, 1000);
                        }, 1500);
                    }, 1000);
                } else {
                    showError(response.error || 'Processing failed');
                    resetProcessingState();
                }
            },
            error: function(xhr) {
                let error = 'Processing error occurred';
                if (xhr.responseJSON && xhr.responseJSON.error) {
                    error = xhr.responseJSON.error;
                }
                showError(error);
                resetProcessingState();
            }
        });
    }
    
    // Upload form submission
    $('#uploadForm').on('submit', function(e) {
        e.preventDefault();
        
        // Check if processing is active
        if (isProcessing) {
            showError('Processing is active. Please stop it first or wait for it to complete.');
            return;
        }
        
        const formData = new FormData(this);
        const uploadBtn = $('#uploadBtn');
        const fileInput = $('#audioFile')[0];
        
        // Validate file
        if (!fileInput.files.length) {
            showError('Please select an audio file');
            return;
        }
        
        // Set processing flag
        isProcessing = true;
        currentProcessing = true;
        
        // Reset players
        resetAudioPlayers();
        
        // Reset and show progress
        resetProcessingSteps();
        $('#progressCard').removeClass('d-none');
        $('#resultsCard').addClass('d-none');
        $('#errorAlert').addClass('d-none');
        $('#statusAlert').addClass('d-none');
        $('#progressText').text('Processing Through Hybrid AI Pipeline...');
        
        // Start processing timer
        startProcessingTimer();
        
        // Update step 1
        updateProcessingStep(1, 'active', 'Uploading audio file...');
        updateProgressDetail('Uploading your audio file to server...');
        
        // Disable button and show loading
        const originalText = uploadBtn.html();
        uploadBtn.prop('disabled', true);
        uploadBtn.html('<i class="fas fa-spinner fa-spin me-2"></i>Processing...');
        
        // Store current settings
        currentVoice = $('#uploadVoiceSelect').val();
        
        // Show cancel button
        $('#cancelUploadBtn').removeClass('d-none');
        
        // Upload audio file
        $.ajax({
            url: '/upload-audio',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                if (response.success) {
                    updateProcessingStep(1, 'completed', 'Uploaded successfully');
                    updateProcessingStep(2, 'active', 'Starting hybrid AI pipeline...');
                    updateProgressDetail('Processing through ASR → Translation → Answer Generation...');
                    
                    // Store timestamp
                    currentTimestamp = response.timestamp;
                    currentSourceType = 'upload';
                    
                    // Start processing with upload endpoint
                    setTimeout(() => {
                        processUploadAudio();
                    }, 1000);
                } else {
                    showError(response.error || 'Upload failed');
                    resetProcessingState();
                }
            },
            error: function(xhr) {
                let error = 'Network error occurred';
                if (xhr.responseJSON && xhr.responseJSON.error) {
                    error = xhr.responseJSON.error;
                } else if (xhr.statusText) {
                    error = xhr.statusText;
                }
                showError(error);
                resetProcessingState();
            }
        });
    });
    
    function processUploadAudio() {
        updateProcessingStep(2, 'active', 'Hybrid AI Processing...');
        updateProgressDetail('Multi-model pipeline: ASR → Ollama Translation → Gemini Answer...');
        
        $.ajax({
            url: '/process-audio',
            type: 'POST',
            success: function(response) {
                if (response.success) {
                    updateProcessingStep(2, 'completed', 'Processing complete');
                    updateProcessingStep(3, 'active', 'Finalizing results...');
                    updateProgressDetail('Finalizing processing results...');
                    
                    // Update UI with results
                    updateUploadResults(response.data);
                    
                    // MODIFIED: Use streaming endpoints instead of download endpoints
                    setupUploadAudioPlayers(response.timestamp);
                    
                    // Update current settings
                    currentTimestamp = response.timestamp;
                    currentSourceType = response.source_type || 'upload';
                    updateSettingsDisplay();
                    
                    // Update source type and badges
                    $('#sourceType').text('File Upload');
                    $('#sourceIcon').removeClass().addClass('fas fa-upload');
                    $('#currentTimestamp').text(response.timestamp);
                    
                    // Update UI for upload
                    updateUIForSourceType(currentSourceType);
                    
                    // Complete the process
                    setTimeout(() => {
                        updateProcessingStep(3, 'completed', 'Results ready');
                        updateProcessingStep(4, 'active', 'Loading audio...');
                        updateProgressDetail('Loading generated audio files...');
                        
                        setTimeout(() => {
                            updateProcessingStep(4, 'completed', 'Audio loaded successfully');
                            updateProgressDetail('Hybrid AI processing completed successfully!');
                            $('#progressBar').css('width', '100%');
                            
                            // Show success message
                            setTimeout(() => {
                                $('#progressCard').addClass('d-none');
                                $('#resultsCard').removeClass('d-none');
                                showStatus('Processing completed through hybrid AI pipeline!');
                                
                                // Scroll to results
                                $('html, body').animate({
                                    scrollTop: $('#resultsCard').offset().top - 20
                                }, 500);
                                
                                // Reset processing state
                                resetProcessingState();
                            }, 1000);
                        }, 1500);
                    }, 1000);
                } else {
                    showError(response.error || 'Processing failed');
                    resetProcessingState();
                }
            },
            error: function(xhr) {
                let error = 'Processing error occurred';
                if (xhr.responseJSON && xhr.responseJSON.error) {
                    error = xhr.responseJSON.error;
                }
                showError(error);
                resetProcessingState();
            }
        });
    }
    
    // -----------------------------
    // AUDIO PLAYER FUNCTIONS
    // -----------------------------
    
    function setupAudioPlayerEvents(type, audioElement) {
        const playerStatusId = type === 'question' ? 'questionPlayerStatus' : 'answerPlayerStatus';
        const progressBarId = type === 'question' ? 'questionProgress' : 'answerProgress';
        const progressBarContainerId = type === 'question' ? 'questionProgressBar' : 'answerProgressBar';
        const currentTimeId = type === 'question' ? 'currentQuestionTime' : 'currentAnswerTime';
        const totalTimeId = type === 'question' ? 'totalQuestionTime' : 'totalAnswerTime';
        const playBtnId = type === 'question' ? 'playQuestionBtn' : 'playAnswerBtn';
        const textElementId = type === 'question' ? 'pashtoQuestionText' : 'pashtoAnswerText';
        
        // Reset text highlighting
        resetTextHighlighting(type);
        
        // Update time display when metadata is loaded
        audioElement.addEventListener('loadedmetadata', function() {
            const duration = audioElement.duration;
            if (duration && duration > 0) {
                $(`#${totalTimeId}`).text(formatTime(duration));
            } else {
                $(`#${totalTimeId}`).text('0:00');
            }
        });
        
        // Update progress during playback
        audioElement.addEventListener('timeupdate', function() {
            const currentTime = audioElement.currentTime;
            const duration = audioElement.duration || 1;
            const progressPercent = (currentTime / duration) * 100;
            
            $(`#${progressBarId}`).css('width', progressPercent + '%');
            $(`#${currentTimeId}`).text(formatTime(currentTime));
            
            // Update text highlighting
            if (currentPlayer === audioElement && currentTextType === type) {
                updateTextHighlighting(type, currentTime, duration);
            }
        });
        
        // Handle playback end
        audioElement.addEventListener('ended', function() {
            $(`#${playerStatusId}`).text('Completed').removeClass('playing paused').addClass('stopped');
            
            // Reset play button
            $(`#${playBtnId}`).find('i').removeClass('fa-pause').addClass('fa-play');
            
            // Mark all words as spoken
            $(`#${textElementId} .highlight-word`)
                .removeClass('current-word')
                .addClass('spoken-word');
            
            isPlaying = false;
            currentPlayer = null;
            currentTextType = null;
        });
        
        // Handle play event
        audioElement.addEventListener('play', function() {
            $(`#${playerStatusId}`).text('Playing').removeClass('stopped paused').addClass('playing');
            
            isPlaying = true;
            currentPlayer = audioElement;
            currentTextType = type;
            
            // Update play button
            $(`#${playBtnId}`).find('i').removeClass('fa-play').addClass('fa-pause');
            
            // Stop other audio if playing
            if (type === 'question' && !answerAudio.paused) {
                answerAudio.pause();
                answerAudio.currentTime = 0;
                resetAudioControl('answer');
            } else if (type === 'answer' && !questionAudio.paused) {
                questionAudio.pause();
                questionAudio.currentTime = 0;
                resetAudioControl('question');
            }
        });
        
        // Handle pause event
        audioElement.addEventListener('pause', function() {
            if (!audioElement.ended) {
                $(`#${playerStatusId}`).text('Paused').removeClass('playing').addClass('paused');
            }
            isPlaying = false;
            
            // Update play button
            $(`#${playBtnId}`).find('i').removeClass('fa-pause').addClass('fa-play');
        });
        
        // Click progress bar to seek
        $(`#${progressBarContainerId}`).on('click', function(e) {
            if (audioElement.duration) {
                const progressBar = $(this);
                const clickPosition = e.pageX - progressBar.offset().left;
                const progressBarWidth = progressBar.width();
                const percentage = (clickPosition / progressBarWidth);
                
                audioElement.currentTime = audioElement.duration * percentage;
                
                if (currentPlayer === audioElement) {
                    updateTextHighlighting(type, audioElement.currentTime, audioElement.duration);
                }
            }
        });
    }
    
    // Audio control event handlers
    $('#playQuestionBtn').on('click', function() {
        if (questionAudio.paused) {
            questionAudio.play().catch(e => {
                showError('Failed to play audio: ' + e.message);
            });
        } else {
            questionAudio.pause();
        }
    });
    
    $('#pauseQuestionBtn').on('click', function() {
        if (!questionAudio.paused) {
            questionAudio.pause();
        }
    });
    
    $('#stopQuestionBtn').on('click', function() {
        questionAudio.pause();
        questionAudio.currentTime = 0;
        resetAudioControl('question');
    });
    
    $('#playAnswerBtn').on('click', function() {
        if (answerAudio.paused) {
            answerAudio.play().catch(e => {
                showError('Failed to play audio: ' + e.message);
            });
        } else {
            answerAudio.pause();
        }
    });
    
    $('#pauseAnswerBtn').on('click', function() {
        if (!answerAudio.paused) {
            answerAudio.pause();
        }
    });
    
    $('#stopAnswerBtn').on('click', function() {
        answerAudio.pause();
        answerAudio.currentTime = 0;
        resetAudioControl('answer');
    });
    
    // Volume controls
    $('#questionVolume').on('input', function() {
        questionAudio.volume = $(this).val() / 100;
    });
    
    $('#answerVolume').on('input', function() {
        answerAudio.volume = $(this).val() / 100;
    });
    
    // -----------------------------
    // TEXT PROCESSING FUNCTIONS
    // -----------------------------
    
    function formatPashtoText(elementId, text) {
        const container = $('#' + elementId);
        container.empty();
        
        if (!text || text === 'Not available' || text === 'Transcription failed') {
            container.html('<span class="text-muted placeholder-text">' + (text || 'Text not available') + '</span>');
            return;
        }
        
        // Split text into words and create highlighted elements
        const words = text.split(/\s+/);
        words.forEach((word, index) => {
            if (word.trim()) {
                const span = $('<span>')
                    .addClass('highlight-word')
                    .attr('data-word-index', index)
                    .text(word + ' ');
                container.append(span);
            }
        });
    }
    
    function updateTextHighlighting(type, currentTime, duration) {
        const textElementId = type === 'question' ? 'pashtoQuestionText' : 'pashtoAnswerText';
        const words = $(`#${textElementId} .highlight-word`);
        
        if (words.length === 0) return;
        
        // Calculate word index based on current time
        const wordDuration = duration / words.length;
        const newWordIndex = Math.min(Math.floor(currentTime / wordDuration), words.length - 1);
        
        // Update highlighting
        words.removeClass('current-word');
        
        // Mark previous words as spoken
        for (let i = 0; i < newWordIndex; i++) {
            $(words[i]).addClass('spoken-word')
                .removeClass('current-word');
        }
        
        // Remove spoken class from current and future words
        for (let i = newWordIndex; i < words.length; i++) {
            $(words[i]).removeClass('spoken-word');
        }
        
        // Highlight current word
        if (newWordIndex < words.length && newWordIndex >= 0) {
            $(words[newWordIndex]).addClass('current-word');
            wordIndex = newWordIndex;
            
            // Scroll word into view if needed
            const wordElement = words[newWordIndex];
            const container = $(`#${textElementId}`).parent();
            const wordTop = $(wordElement).position().top;
            const containerTop = container.scrollTop();
            const containerHeight = container.height();
            
            if (wordTop < containerTop || wordTop > containerTop + containerHeight - 30) {
                container.animate({
                    scrollTop: wordTop - 10
                }, 300);
            }
        }
    }
    
    function resetTextHighlighting(type) {
        const textElementId = type === 'question' ? 'pashtoQuestionText' : 'pashtoAnswerText';
        $(`#${textElementId} .highlight-word`)
            .removeClass('current-word spoken-word');
        wordIndex = 0;
    }
    
    function resetAudioControl(type) {
        const playerStatusId = type === 'question' ? 'questionPlayerStatus' : 'answerPlayerStatus';
        const progressBarId = type === 'question' ? 'questionProgress' : 'answerProgress';
        const currentTimeId = type === 'question' ? 'currentQuestionTime' : 'currentAnswerTime';
        const playBtnId = type === 'question' ? 'playQuestionBtn' : 'playAnswerBtn';
        const totalTimeId = type === 'question' ? 'totalQuestionTime' : 'totalAnswerTime';
        
        $(`#${playerStatusId}`).text('Stopped').removeClass('playing paused').addClass('stopped');
        $(`#${progressBarId}`).css('width', '0%');
        $(`#${currentTimeId}`).text('0:00');
        $(`#${totalTimeId}`).text('0:00');
        $(`#${playBtnId}`).find('i').removeClass('fa-pause').addClass('fa-play');
        
        resetTextHighlighting(type);
    }
    
    function formatTime(seconds) {
        if (isNaN(seconds) || seconds === Infinity) return "0:00";
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    
    // -----------------------------
    // UI UPDATE FUNCTIONS
    // -----------------------------
    
    function updateRecordingResults(data) {
        const pashtoQuestion = data.pashto_question || 'Transcription not available';
        const englishQuestion = data.english_question || 'Translation not available';
        const pashtoAnswer = data.pashto_answer || 'Answer not available';
        const englishAnswer = data.english_answer || 'Answer translation not available';
        
        // Format Pashto text with highlighting
        formatPashtoText('pashtoQuestionText', pashtoQuestion);
        $('#englishQuestionText').text(englishQuestion);
        formatPashtoText('pashtoAnswerText', pashtoAnswer);
        $('#englishAnswerText').text(englishAnswer);
    }
    
    function updateUploadResults(data) {
        const pashtoQuestion = data.pashto_question || 'Question not available';
        const englishQuestion = data.english_question || 'Translation not available';
        const pashtoAnswer = data.pashto_answer || 'Answer not available';
        const englishAnswer = data.english_answer || 'Answer translation not available';
        
        // Format Pashto text with highlighting
        formatPashtoText('pashtoQuestionText', pashtoQuestion);
        $('#englishQuestionText').text(englishQuestion);
        formatPashtoText('pashtoAnswerText', pashtoAnswer);
        $('#englishAnswerText').text(englishAnswer);
    }
    
    function updateUIForSourceType(sourceType) {
        if (sourceType === 'recording') {
            $('#recordingModeBadge').removeClass('d-none');
            $('#uploadModeBadge').addClass('d-none');
            $('#sourceIcon').removeClass().addClass('fas fa-microphone');
            $('#sourceType').text('Live Recording');
        } else {
            $('#uploadModeBadge').removeClass('d-none');
            $('#recordingModeBadge').addClass('d-none');
            $('#sourceIcon').removeClass().addClass('fas fa-upload');
            $('#sourceType').text('File Upload');
        }
        
        // Enable answer audio controls
        $('#regenerateAnswerBtn').removeClass('d-none');
        // MODIFIED: Hide download buttons since files aren't saved
        $('#downloadAnswerBtn, #downloadAnswerFullBtn').addClass('d-none');
        
        // Enable answer player controls
        $('#playAnswerBtn').prop('disabled', false);
        $('#pauseAnswerBtn').prop('disabled', false);
        $('#stopAnswerBtn').prop('disabled', false);
        $('#answerVolume').prop('disabled', false);
        
        // Update answer audio player UI
        $('#answerAudioPlayer').removeClass('bg-light').css('opacity', '1');
        $('#answerPlayerStatus').text('Stopped').removeClass('playing paused').addClass('stopped');
        
        // Update labels
        $('.result-card-header h4').each(function() {
            if ($(this).text().includes('Pashto Answer')) {
                $(this).html('<i class="fas fa-comment-dots me-2"></i>Pashto Answer <span class="badge bg-white text-primary float-end ms-2" id="answerStatus">Ready</span>');
            }
        });
        
        // MODIFIED: Update download section text to indicate streaming only
        $('.download-btn[data-type="audio_pashto_question"]').html('<i class="fas fa-play-circle me-2"></i>Play Question Audio');
        
        // Show regenerate all button
        $('#regenerateAllAudioBtn').prop('disabled', false).removeClass('d-none');
    }
    
    function setupRecordingAudioPlayers(timestamp) {
        currentTimestamp = timestamp;
        sessionStorage.setItem('currentTimestamp', timestamp);
        sessionStorage.setItem('sourceType', 'recording');
        
        // MODIFIED: Use streaming endpoint instead of download endpoint
        questionAudio.src = `/play-audio/question?_=${Date.now()}`;
        answerAudio.src = `/play-audio/answer?_=${Date.now()}`;
        
        // Update UI for recording mode
        updateUIForSourceType('recording');
    }
    
    function setupUploadAudioPlayers(timestamp) {
        currentTimestamp = timestamp;
        sessionStorage.setItem('currentTimestamp', timestamp);
        sessionStorage.setItem('sourceType', 'upload');
        
        // MODIFIED: Use streaming endpoint instead of download endpoint
        questionAudio.src = `/play-audio/question?_=${Date.now()}`;
        answerAudio.src = `/play-audio/answer?_=${Date.now()}`;
        
        // Update UI for upload mode
        updateUIForSourceType('upload');
    }
    
    function updateSettingsDisplay() {
        const voiceSelect = $('#recordVoiceSelect');
        const selectedVoice = voiceSelect.find('option:selected');
        const voiceName = selectedVoice.text().split(' - ')[0];
        $('#currentSettings').text(`Hybrid AI System | TTS: ${voiceName}`);
    }
    
    // -----------------------------
    // PROCESSING CONTROLS
    // -----------------------------
    
    // Stop processing button
    $('#stopProcessingBtn').on('click', function() {
        stopProcessing();
    });
    
    // Stop progress button
    $('#stopProgressBtn').on('click', function() {
        stopProcessing();
    });
    
    function stopProcessing() {
        $.ajax({
            url: '/stop-processing',
            type: 'POST',
            success: function(response) {
                if (response.success) {
                    showStatus('Processing stopped. You can now upload new audio or record again.');
                    
                    // Hide progress card and processing control
                    $('#progressCard').addClass('d-none');
                    $('#processingControlCard').addClass('d-none');
                    
                    // Reset processing state
                    isProcessing = false;
                    currentProcessing = false;
                    
                    // Reset buttons
                    resetButtons();
                    
                    // Reset processing timer
                    stopProcessingTimer();
                    
                    // Enable tabs and buttons
                    $('.nav-tabs .nav-link').prop('disabled', false);
                    $('.btn:not(#stopProcessingBtn)').prop('disabled', false);
                    
                    // Clear any recording
                    resetRecording();
                    
                    // Scroll to top
                    $('html, body').animate({
                        scrollTop: 0
                    }, 500);
                } else {
                    showError(response.error || 'Failed to stop processing');
                }
            },
            error: function() {
                showError('Failed to stop processing');
            }
        });
    }
    
    function updateProcessingTime() {
        if (!processingStartTime) return;
        
        const elapsedSeconds = Math.floor((Date.now() - processingStartTime) / 1000);
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;
        
        $('#timeElapsed').text(`Time elapsed: ${minutes}m ${seconds}s`);
    }
    
    function startProcessingTimer() {
        processingStartTime = Date.now();
        processingTimer = setInterval(updateProcessingTime, 1000);
    }
    
    function stopProcessingTimer() {
        if (processingTimer) {
            clearInterval(processingTimer);
            processingTimer = null;
        }
        processingStartTime = null;
    }
    
    function updateProcessingStep(stepNumber, status, message = '') {
        const step = $('#step' + stepNumber);
        const stepStatus = step.find('.step-status');
        
        step.removeClass('active completed');
        
        if (status === 'active') {
            step.addClass('active');
            stepStatus.text(message || 'In progress...');
            
            // Update progress bar
            const progressPercent = (stepNumber - 1) * 25 + 25;
            $('#progressBar').css('width', progressPercent + '%');
            
            // Update previous steps
            for (let i = 1; i < stepNumber; i++) {
                $('#step' + i).addClass('completed');
                $('#step' + i + ' .step-line').addClass('completed');
            }
        } else if (status === 'completed') {
            step.addClass('completed');
            stepStatus.text(message || 'Completed');
        } else if (status === 'pending') {
            stepStatus.text('');
        }
    }
    
    function updateProgressDetail(message) {
        $('#progressDetail').text(message);
    }
    
    function resetProcessingSteps() {
        for (let i = 1; i <= 4; i++) {
            const step = $('#step' + i);
            step.removeClass('active completed');
            step.find('.step-status').text('');
            step.find('.step-line').removeClass('completed');
        }
        $('#progressBar').css('width', '0%');
        $('#timeElapsed').text('Time elapsed: 0s');
    }
    
    function resetProcessingState() {
        isProcessing = false;
        currentProcessing = false;
        
        // Reset recording button
        $('#processRecordingBtn').prop('disabled', true).html('<i class="fas fa-play-circle me-2"></i>Process Recording');
        
        // Reset upload button
        $('#uploadBtn').prop('disabled', false).html('<i class="fas fa-upload me-2"></i> Upload & Process');
        
        // Hide cancel buttons
        $('#cancelRecordingBtn').addClass('d-none');
        $('#cancelUploadBtn').addClass('d-none');
        
        // Stop processing timer
        stopProcessingTimer();
    }
    
    function resetButtons() {
        // Reset recording buttons
        $('#processRecordingBtn').prop('disabled', true).html('<i class="fas fa-play-circle me-2"></i>Process Recording');
        $('#startRecordingBtn').removeClass('d-none');
        $('#stopRecordingBtn').addClass('d-none');
        $('#playRecordingBtn').addClass('d-none');
        $('#reRecordBtn').addClass('d-none');
        $('#cancelRecordingBtn').addClass('d-none');
        
        // Reset upload buttons
        $('#uploadBtn').prop('disabled', false).html('<i class="fas fa-upload me-2"></i> Upload & Process');
        $('#cancelUploadBtn').addClass('d-none');
        
        // Reset progress button
        $('#stopProgressBtn').prop('disabled', false).html('<i class="fas fa-stop me-2"></i>Stop Processing');
        
        // Reset processing control button
        $('#stopProcessingBtn').prop('disabled', false).html('<i class="fas fa-stop me-1"></i>Stop Processing');
        
        // Reset regenerate all button
        $('#regenerateAllAudioBtn').prop('disabled', false).removeClass('d-none');
        
        // Enable all buttons
        $('.btn').prop('disabled', false);
    }
    
    function resetAudioPlayers() {
        // Stop all audio
        if (questionAudio) {
            questionAudio.pause();
            questionAudio.currentTime = 0;
        }
        if (answerAudio) {
            answerAudio.pause();
            answerAudio.currentTime = 0;
        }
        
        // Reset UI
        resetAudioControl('question');
        resetAudioControl('answer');
        
        // Clear sources
        if (questionAudio) questionAudio.src = '';
        if (answerAudio) answerAudio.src = '';
        
        isPlaying = false;
        currentPlayer = null;
        currentTextType = null;
        wordIndex = 0;
    }
    
    // -----------------------------
    // DOWNLOAD & REGENERATION
    // -----------------------------
    
    // MODIFIED: Disable download buttons and show message
    $(document).on('click', '.download-btn', function(e) {
        e.preventDefault();
        showStatus('Audio streaming is available - files are not saved to disk. Use Play buttons to listen.');
    });
    
    $('#downloadRecordingBtn').on('click', function() {
        showStatus('Recording is not saved to disk. Use Play button to listen.');
    });
    
    // Regenerate audio buttons
    $(document).on('click', '.regenerate-audio-btn', function(e) {
        e.preventDefault();
        currentAudioType = $(this).data('type');
        
        // Update modal text based on audio type
        const audioTypeText = currentAudioType === 'pashto_question' ? 'question' : 'answer';
        $('#regenerateModalText').text(`Generate new Pashto ${audioTypeText} audio using current text?`);
        
        // Show confirmation modal
        $('#regenerateModal').modal('show');
    });
    
    $('#regenerateAllAudioBtn').on('click', function(e) {
        e.preventDefault();
        currentAudioType = 'all';
        
        // Update modal text
        $('#regenerateModalText').text('Generate new Pashto question and answer audio using current text?');
        
        // Show confirmation modal
        $('#regenerateModal').modal('show');
    });
    
    // Confirm regenerate audio
    $('#confirmRegenerateBtn').on('click', function() {
        $('#regenerateModal').modal('hide');
        
        if (!currentAudioType) return;
        
        // Show loading state
        const originalText = $(this).html();
        $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-2"></i>Regenerating...');
        
        $.ajax({
            url: `/regenerate-audio/${currentAudioType}`,
            type: 'POST',
            success: function(response) {
                if (response.success) {
                    showStatus(response.message);
                    
                    // MODIFIED: Update audio sources with streaming endpoint
                    if (questionAudio) {
                        questionAudio.src = `/play-audio/question?_=${Date.now()}`;
                    }
                    if (answerAudio) {
                        answerAudio.src = `/play-audio/answer?_=${Date.now()}`;
                    }
                    
                    // Reset audio controls
                    resetAudioControl('question');
                    resetAudioControl('answer');
                } else {
                    showError(response.error || 'Failed to regenerate audio');
                }
                $('#confirmRegenerateBtn').prop('disabled', false).html(originalText);
            },
            error: function(xhr) {
                let error = 'Network error occurred';
                if (xhr.responseJSON && xhr.responseJSON.error) {
                    error = xhr.responseJSON.error;
                }
                showError(error);
                $('#confirmRegenerateBtn').prop('disabled', false).html(originalText);
            }
        });
    });
    
    // Replace audio functionality
    $('#confirmReplaceBtn').on('click', function() {
        const formData = new FormData($('#replaceAudioForm')[0]);
        const fileInput = $('#replaceAudioFile')[0];
        
        if (!fileInput.files.length) {
            showError('Please select an audio file to replace');
            return;
        }
        
        // Show loading state
        const originalText = $(this).html();
        $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-2"></i>Processing...');
        
        $.ajax({
            url: '/replace-audio',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                if (response.success) {
                    $('#replaceModal').modal('hide');
                    showStatus('Audio replaced successfully. Processing...');
                    
                    // Reset and show progress
                    resetProcessingSteps();
                    $('#progressCard').removeClass('d-none');
                    $('#resultsCard').addClass('d-none');
                    
                    // Start processing timer
                    startProcessingTimer();
                    
                    // Update step 1
                    updateProcessingStep(1, 'active', 'Uploading new audio...');
                    updateProgressDetail('Processing new audio file through hybrid AI pipeline...');
                    
                    // Process the new audio
                    setTimeout(() => {
                        processUploadAudio();
                    }, 500);
                } else {
                    showError(response.error || 'Failed to replace audio');
                }
                $('#confirmReplaceBtn').prop('disabled', false).html(originalText);
            },
            error: function(xhr) {
                let error = 'Network error occurred';
                if (xhr.responseJSON && xhr.responseJSON.error) {
                    error = xhr.responseJSON.error;
                }
                showError(error);
                $('#confirmReplaceBtn').prop('disabled', false).html(originalText);
            }
        });
    });
    
    // Clear session button
    $('#clearBtn').on('click', function() {
        if (confirm('Are you sure you want to clear all results and start over? This will delete all files.')) {
            resetAudioPlayers();
            
            $.ajax({
                url: '/clear-session',
                type: 'POST',
                success: function(response) {
                    if (response.success) {
                        $('#resultsCard').addClass('d-none');
                        $('#uploadForm')[0].reset();
                        showStatus('Session cleared. You can now upload a new audio file or start recording.');
                        
                        // Reset settings
                        currentVoice = 'ps';
                        currentTimestamp = '';
                        currentSourceType = '';
                        sessionStorage.removeItem('currentTimestamp');
                        sessionStorage.removeItem('sourceType');
                        window.recordedAudioBlob = null;
                        
                        // Reset recording UI
                        resetRecording();
                        
                        // Reset processing state
                        isProcessing = false;
                        currentProcessing = false;
                        
                        // Stop processing timer
                        stopProcessingTimer();
                        
                        // Reset progress steps
                        resetProcessingSteps();
                        
                        // Scroll to top
                        $('html, body').animate({
                            scrollTop: 0
                        }, 500);
                    } else {
                        showError(response.error || 'Failed to clear session');
                    }
                },
                error: function() {
                    showError('Failed to clear session');
                }
            });
        }
    });
    
    // -----------------------------
    // ERROR & STATUS HANDLING
    // -----------------------------
    
    function showError(message) {
        $('#errorAlert').html(`
            <div class="d-flex align-items-center">
                <i class="fas fa-exclamation-circle me-3" style="font-size: 1.5rem;"></i>
                <div>${message}</div>
            </div>
        `).removeClass('d-none');
        
        $('#progressCard').addClass('d-none');
        scrollToElement('#errorAlert');
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            $('#errorAlert').addClass('d-none');
        }, 10000);
    }
    
    function showStatus(message) {
        $('#statusAlert').html(`
            <div class="d-flex align-items-center">
                <i class="fas fa-info-circle me-3" style="font-size: 1.5rem;"></i>
                <div>${message}</div>
            </div>
        `).removeClass('d-none');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            $('#statusAlert').addClass('d-none');
        }, 5000);
    }
    
    function scrollToElement(selector) {
        const element = $(selector);
        if (element.length) {
            $('html, body').animate({
                scrollTop: element.offset().top - 20
            }, 500);
        }
    }
});


























// $(document).ready(function() {
//     // Audio player instances
//     let questionAudio = document.getElementById('questionAudio');
//     let answerAudio = document.getElementById('answerAudio');
    
//     // Current state
//     let currentPlayer = null;
//     let currentTextType = null;
//     let wordIndex = 0;
//     let isPlaying = false;
//     let currentVoice = 'ps';
//     let currentTimestamp = '';
//     let mediaRecorder = null;
//     let audioChunks = [];
//     let recordingTimer = null;
//     let recordingSeconds = 0;
//     let processingTimer = null;
//     let processingStartTime = null;
//     let currentAudioType = null;
//     let isProcessing = false;
//     let currentProcessing = false;
//     let audioStream = null;
//     let currentSourceType = '';
    
//     // Initialize
//     initializeApp();
    
//     // -----------------------------
//     // INITIALIZATION FUNCTIONS
//     // -----------------------------
    
//     function initializeApp() {
//         // Initialize tooltips
//         $('[data-bs-toggle="tooltip"]').tooltip();
        
//         // Initialize visualizer
//         initializeVisualizer();
        
//         // Initialize audio players
//         initializeAudioPlayers();
        
//         // Check processing status periodically
//         setInterval(checkProcessingStatus, 3000);
        
//         // Set up microphone permission check
//         setupMicrophonePermission();
//     }
    
//     function setupMicrophonePermission() {
//         // Check microphone permission only when needed
//         updateMicrophoneStatusDisplay();
        
//         // Listen for permission request button
//         $('#requestPermissionBtn').on('click', function() {
//             requestMicrophonePermission();
//         });
//     }
    
//     function updateMicrophoneStatusDisplay() {
//         const statusElement = $('#microphoneStatusText');
//         const permissionStatusElement = $('#permissionStatus');
        
//         if (!statusElement.length) return;
        
//         // Check if permission API is supported
//         if (!navigator.permissions || !navigator.permissions.query) {
//             statusElement.text('Click "Allow Microphone Access" to enable recording');
//             if (permissionStatusElement.length) {
//                 permissionStatusElement.html('<i class="fas fa-info-circle me-2"></i> Click "Allow Microphone Access" to request permission');
//             }
//             return;
//         }
        
//         // Check current permission status
//         navigator.permissions.query({ name: 'microphone' })
//             .then(permissionStatus => {
//                 updatePermissionUI(permissionStatus.state);
                
//                 // Listen for permission changes
//                 permissionStatus.onchange = function() {
//                     updatePermissionUI(this.state);
//                 };
//             })
//             .catch(error => {
//                 console.error('Permission query error:', error);
//                 statusElement.text('Click "Allow Microphone Access" to enable recording');
//                 if (permissionStatusElement.length) {
//                     permissionStatusElement.html('<i class="fas fa-info-circle me-2"></i> Click "Allow Microphone Access" to request permission');
//                 }
//             });
//     }
    
//     function updatePermissionUI(state) {
//         const statusElement = $('#microphoneStatusText');
//         const permissionStatusElement = $('#permissionStatus');
//         const requestBtn = $('#requestPermissionBtn');
        
//         if (!statusElement.length) return;
        
//         switch(state) {
//             case 'granted':
//                 statusElement.html('<span class="text-success"><i class="fas fa-check-circle me-1"></i>Microphone access granted</span>');
//                 if (permissionStatusElement.length) {
//                     permissionStatusElement.html('<i class="fas fa-check-circle me-2 text-success"></i> Microphone permission granted!');
//                 }
//                 if (requestBtn.length) {
//                     requestBtn.html('<i class="fas fa-check-circle me-2"></i>Permission Granted')
//                         .prop('disabled', false)
//                         .removeClass('btn-primary')
//                         .addClass('btn-success');
//                 }
                
//                 // Hide permission card, show recording interface
//                 setTimeout(() => {
//                     $('#microphonePermissionCard').addClass('d-none');
//                     $('#recordingInterface').removeClass('d-none');
//                 }, 500);
//                 break;
                
//             case 'denied':
//                 statusElement.html('<span class="text-danger"><i class="fas fa-times-circle me-1"></i>Microphone access denied. Allow in browser settings.</span>');
//                 if (permissionStatusElement.length) {
//                     permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> Microphone permission denied. Please allow in browser settings.');
//                 }
//                 if (requestBtn.length) {
//                     requestBtn.html('<i class="fas fa-microphone-slash me-2"></i>Permission Denied')
//                         .prop('disabled', true)
//                         .removeClass('btn-primary')
//                         .addClass('btn-danger');
//                 }
//                 break;
                
//             default:
//                 statusElement.html('<span>Click "Allow Microphone Access" to enable recording</span>');
//                 if (permissionStatusElement.length) {
//                     permissionStatusElement.html('<i class="fas fa-info-circle me-2"></i> Click "Allow Microphone Access" to request permission');
//                 }
//                 if (requestBtn.length) {
//                     requestBtn.html('<i class="fas fa-microphone me-2"></i>Allow Microphone Access')
//                         .prop('disabled', false)
//                         .removeClass('btn-success', 'btn-danger')
//                         .addClass('btn-primary');
//                 }
//                 break;
//         }
//     }
    
//     async function requestMicrophonePermission() {
//         try {
//             const permissionStatusElement = $('#permissionStatus');
//             const requestBtn = $('#requestPermissionBtn');
            
//             if (permissionStatusElement.length) {
//                 permissionStatusElement.html('<i class="fas fa-spinner fa-spin me-2"></i> Requesting microphone permission...');
//             }
            
//             if (requestBtn.length) {
//                 requestBtn.html('<i class="fas fa-spinner fa-spin me-2"></i>Requesting...')
//                     .prop('disabled', true);
//             }
            
//             // Request microphone permission
//             const stream = await navigator.mediaDevices.getUserMedia({ 
//                 audio: {
//                     echoCancellation: true,
//                     noiseSuppression: true,
//                     autoGainControl: true
//                 } 
//             });
            
//             // Stop the stream - we just needed permission
//             stream.getTracks().forEach(track => track.stop());
            
//             // Update status via permission API
//             updateMicrophoneStatusDisplay();
            
//         } catch (error) {
//             console.error('Microphone permission error:', error);
            
//             const permissionStatusElement = $('#permissionStatus');
//             const requestBtn = $('#requestPermissionBtn');
            
//             if (permissionStatusElement.length) {
//                 if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
//                     permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> Microphone permission denied. Please allow in browser settings.');
//                 } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
//                     permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> No microphone found. Please connect a microphone.');
//                 } else {
//                     permissionStatusElement.html('<i class="fas fa-times-circle me-2 text-danger"></i> Error: ' + error.message);
//                 }
//             }
            
//             if (requestBtn.length) {
//                 requestBtn.html('<i class="fas fa-microphone me-2"></i>Try Again')
//                     .prop('disabled', false);
//             }
            
//             // Update status display
//             updateMicrophoneStatusDisplay();
//         }
//     }
    
//     function initializeVisualizer() {
//         const visualizer = $('#visualizer');
//         visualizer.empty();
//         for (let i = 0; i < 8; i++) {
//             visualizer.append('<div class="bar"></div>');
//         }
//     }
    
//     function initializeAudioPlayers() {
//         if (!questionAudio || !answerAudio) {
//             console.error('Audio elements not found');
//             return;
//         }
        
//         questionAudio.volume = 1.0;
//         answerAudio.volume = 1.0;
        
//         // Set initial volume slider values
//         $('#questionVolume').val(100);
//         $('#answerVolume').val(100);
        
//         // Setup audio player events
//         setupAudioPlayerEvents('question', questionAudio);
//         setupAudioPlayerEvents('answer', answerAudio);
//     }
    
//     // -----------------------------
//     // PROCESSING STATUS MANAGEMENT
//     // -----------------------------
    
//     function checkProcessingStatus() {
//         if (isProcessing || currentProcessing) {
//             $.ajax({
//                 url: '/get-processing-status',
//                 type: 'GET',
//                 success: function(response) {
//                     if (response.is_processing && !currentProcessing) {
//                         // Another process is running
//                         showProcessingControl();
//                     } else if (!response.is_processing && currentProcessing) {
//                         // Our process stopped
//                         hideProcessingControl();
//                     }
//                 },
//                 error: function() {
//                     // Silently handle errors
//                 }
//             });
//         }
//     }
    
//     function showProcessingControl() {
//         $('#processingControlCard').removeClass('d-none');
//         $('.nav-tabs .nav-link').prop('disabled', true);
//         $('.btn:not(#stopProcessingBtn, #stopProgressBtn)').prop('disabled', true);
//         $('#processingStatusText').text('Processing through hybrid AI pipeline...');
//     }
    
//     function hideProcessingControl() {
//         $('#processingControlCard').addClass('d-none');
//         $('.nav-tabs .nav-link').prop('disabled', false);
//         $('.btn:not(#stopProcessingBtn, #stopProgressBtn)').prop('disabled', false);
//         resetButtons();
//     }
    
//     // -----------------------------
//     // RECORDING FUNCTIONS
//     // -----------------------------
    
//     $('#startRecordingBtn').on('click', async function() {
//         try {
//             // Check if processing is active
//             if (isProcessing) {
//                 showError('Processing is active. Please stop it first or wait for it to complete.');
//                 return;
//             }
            
//             // Check microphone permission first
//             const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
//             if (permissionStatus.state !== 'granted') {
//                 // Ask for permission
//                 await requestMicrophonePermission();
//                 return;
//             }
            
//             // Reset any previous recording
//             if (window.recordedAudioBlob) {
//                 URL.revokeObjectURL(window.recordedAudioBlob);
//                 window.recordedAudioBlob = null;
//             }
            
//             // Clear previous audio chunks
//             audioChunks = [];
            
//             // Get microphone stream
//             audioStream = await navigator.mediaDevices.getUserMedia({ 
//                 audio: {
//                     channelCount: 1,
//                     sampleRate: 16000,
//                     echoCancellation: true,
//                     noiseSuppression: true,
//                     autoGainControl: true
//                 } 
//             });
            
//             // Get available MIME types
//             const mimeTypes = [
//                 'audio/webm;codecs=opus',
//                 'audio/webm',
//                 'audio/ogg;codecs=opus',
//                 'audio/mp4',
//                 'audio/mpeg'
//             ];
            
//             let selectedMimeType = '';
//             for (const mimeType of mimeTypes) {
//                 if (MediaRecorder.isTypeSupported(mimeType)) {
//                     selectedMimeType = mimeType;
//                     break;
//                 }
//             }
            
//             if (!selectedMimeType) {
//                 selectedMimeType = 'audio/webm';
//             }
            
//             console.log('Using MIME type:', selectedMimeType);
            
//             // Create MediaRecorder
//             mediaRecorder = new MediaRecorder(audioStream, {
//                 mimeType: selectedMimeType
//             });
            
//             mediaRecorder.ondataavailable = event => {
//                 if (event.data && event.data.size > 0) {
//                     audioChunks.push(event.data);
//                 }
//             };
            
//             mediaRecorder.onstop = async () => {
//                 try {
//                     if (audioChunks.length === 0) {
//                         showError('Recording failed: No audio data captured.');
//                         resetRecording();
//                         return;
//                     }
                    
//                     const audioBlob = new Blob(audioChunks, { 
//                         type: selectedMimeType 
//                     });
                    
//                     if (audioBlob.size === 0) {
//                         showError('Recording is empty. Please try again.');
//                         resetRecording();
//                         return;
//                     }
                    
//                     const audioUrl = URL.createObjectURL(audioBlob);
                    
//                     // Show recorded audio preview
//                     $('#recordedAudio').attr('src', audioUrl);
//                     $('#recordingPreview').removeClass('d-none');
//                     $('#playRecordingBtn').removeClass('d-none');
//                     $('#reRecordBtn').removeClass('d-none');
//                     $('#processRecordingBtn').prop('disabled', false);
//                     $('#cancelRecordingBtn').removeClass('d-none');
//                     $('#recordingInfoAlert').removeClass('d-none');
                    
//                     // Store blob for later use
//                     window.recordedAudioBlob = audioBlob;
                    
//                     console.log('Recording saved, size:', audioBlob.size, 'bytes');
//                 } catch (error) {
//                     console.error('Error processing recording:', error);
//                     showError('Error processing recording: ' + error.message);
//                     resetRecording();
//                 }
//             };
            
//             mediaRecorder.onerror = (event) => {
//                 console.error('MediaRecorder error:', event.error);
//                 showError('Recording error: ' + event.error);
//                 resetRecording();
//             };
            
//             // Start recording with smaller chunks
//             mediaRecorder.start(100); // Collect data every 100ms
            
//             // Start recording timer
//             recordingSeconds = 0;
//             clearInterval(recordingTimer);
//             recordingTimer = setInterval(() => {
//                 recordingSeconds++;
//                 const minutes = Math.floor(recordingSeconds / 60);
//                 const seconds = recordingSeconds % 60;
//                 $('#recordingTimer').text(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                
//                 // Stop recording after 60 seconds
//                 if (recordingSeconds >= 60) {
//                     stopRecording();
//                 }
//             }, 1000);
            
//             // Update UI
//             $('#startRecordingBtn').addClass('d-none');
//             $('#stopRecordingBtn').removeClass('d-none');
//             $('#recordingStatus').html('<i class="fas fa-microphone text-danger"></i> <span class="ms-2">Recording...</span>');
//             $('#visualizer .bar').css('animation-play-state', 'running');
            
//             console.log('Recording started successfully');
            
//         } catch (error) {
//             console.error('Recording setup error:', error);
            
//             if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
//                 showError('Microphone permission denied. Please allow microphone access in your browser settings.');
//                 // Show permission card
//                 $('#microphonePermissionCard').removeClass('d-none');
//                 $('#recordingInterface').addClass('d-none');
//             } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
//                 showError('No microphone found. Please connect a microphone and try again.');
//             } else {
//                 showError('Failed to access microphone: ' + error.message);
//             }
            
//             // Reset UI
//             $('#startRecordingBtn').removeClass('d-none');
//             $('#stopRecordingBtn').addClass('d-none');
//             $('#recordingStatus').html('<i class="fas fa-microphone-slash text-muted"></i> <span class="ms-2">Ready to record</span>');
//         }
//     });
    
//     $('#stopRecordingBtn').on('click', function() {
//         stopRecording();
//     });
    
//     $('#playRecordingBtn').on('click', function() {
//         const recordedAudio = document.getElementById('recordedAudio');
//         if (recordedAudio) {
//             if (recordedAudio.paused) {
//                 recordedAudio.play();
//                 $(this).find('i').removeClass('fa-play').addClass('fa-pause');
//             } else {
//                 recordedAudio.pause();
//                 $(this).find('i').removeClass('fa-pause').addClass('fa-play');
//             }
//         }
//     });
    
//     $('#reRecordBtn').on('click', function() {
//         resetRecording();
//     });
    
//     $('#cancelRecordingBtn').on('click', function() {
//         resetRecording();
//     });
    
//     $('#cancelUploadBtn').on('click', function() {
//         resetUpload();
//     });
    
//     $('#recordedAudio').on('ended', function() {
//         $('#playRecordingBtn').find('i').removeClass('fa-pause').addClass('fa-play');
//     });
    
//     function stopRecording() {
//         if (mediaRecorder && mediaRecorder.state !== 'inactive') {
//             mediaRecorder.stop();
//         }
        
//         // Stop audio stream
//         if (audioStream) {
//             audioStream.getTracks().forEach(track => {
//                 track.stop();
//                 track.enabled = false;
//             });
//             audioStream = null;
//         }
        
//         clearInterval(recordingTimer);
        
//         // Update UI
//         $('#startRecordingBtn').removeClass('d-none');
//         $('#stopRecordingBtn').addClass('d-none');
//         $('#recordingStatus').html('<i class="fas fa-check-circle text-success"></i> <span class="ms-2">Recording complete</span>');
//         $('#visualizer .bar').css('animation-play-state', 'paused');
        
//         console.log('Recording stopped');
//     }
    
//     function resetRecording() {
//         // Stop recording if active
//         if (mediaRecorder && mediaRecorder.state !== 'inactive') {
//             try {
//                 mediaRecorder.stop();
//             } catch (e) {
//                 console.log('MediaRecorder already stopped');
//             }
//         }
        
//         // Stop audio stream
//         if (audioStream) {
//             audioStream.getTracks().forEach(track => {
//                 track.stop();
//                 track.enabled = false;
//             });
//             audioStream = null;
//         }
        
//         clearInterval(recordingTimer);
        
//         // Reset UI
//         $('#startRecordingBtn').removeClass('d-none');
//         $('#stopRecordingBtn').addClass('d-none');
//         $('#playRecordingBtn').addClass('d-none');
//         $('#reRecordBtn').addClass('d-none');
//         $('#recordingPreview').addClass('d-none');
//         $('#recordingInfoAlert').addClass('d-none');
//         $('#processRecordingBtn').prop('disabled', true);
//         $('#cancelRecordingBtn').addClass('d-none');
//         $('#recordingStatus').html('<i class="fas fa-microphone-slash text-muted"></i> <span class="ms-2">Ready to record</span>');
//         $('#recordingTimer').text('00:00');
//         $('#visualizer .bar').css('animation-play-state', 'paused');
        
//         // Clear audio data
//         audioChunks = [];
//         if (window.recordedAudioBlob) {
//             URL.revokeObjectURL(window.recordedAudioBlob);
//             window.recordedAudioBlob = null;
//         }
//         recordingSeconds = 0;
        
//         console.log('Recording reset');
//     }
    
//     function resetUpload() {
//         $('#audioFile').val('');
//         $('#cancelUploadBtn').addClass('d-none');
//         $('#uploadBtn').prop('disabled', false).html('<i class="fas fa-upload me-2"></i> Upload & Process');
//     }
    
//     // -----------------------------
//     // PROCESSING FUNCTIONS
//     // -----------------------------
    
//     $('#processRecordingBtn').on('click', function() {
//         processRecording();
//     });
    
//     function processRecording() {
//         if (!window.recordedAudioBlob) {
//             showError('No recording found. Please record audio first.');
//             return;
//         }
        
//         // Set processing flag
//         isProcessing = true;
//         currentProcessing = true;
        
//         // Reset players
//         resetAudioPlayers();
        
//         // Reset and show progress
//         resetProcessingSteps();
//         $('#progressCard').removeClass('d-none');
//         $('#resultsCard').addClass('d-none');
//         $('#errorAlert').addClass('d-none');
//         $('#statusAlert').addClass('d-none');
//         $('#progressText').text('Processing Through Hybrid AI Pipeline...');
        
//         // Start processing timer
//         startProcessingTimer();
        
//         // Update step 1
//         updateProcessingStep(1, 'active', 'Uploading recording...');
//         updateProgressDetail('Uploading recording to server...');
        
//         // Get voice selection
//         const voice = $('#recordVoiceSelect').val();
//         currentVoice = voice;
        
//         // Disable button
//         const originalText = $('#processRecordingBtn').html();
//         $('#processRecordingBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-2"></i>Processing...');
        
//         // Create FormData to send audio
//         const formData = new FormData();
//         formData.append('audio', window.recordedAudioBlob, 'recording.webm');
//         formData.append('voice', voice);
        
//         // Send recording to server
//         $.ajax({
//             url: '/upload-recording',
//             type: 'POST',
//             data: formData,
//             processData: false,
//             contentType: false,
//             success: function(response) {
//                 if (response.success) {
//                     updateProcessingStep(1, 'completed', 'Uploaded successfully');
//                     updateProcessingStep(2, 'active', 'Starting hybrid AI pipeline...');
//                     updateProgressDetail('Processing through ASR → Translation → Answer Generation...');
                    
//                     // Store timestamp for later use
//                     currentTimestamp = response.timestamp;
//                     currentSourceType = 'recording';
                    
//                     // Start processing with recording endpoint
//                     setTimeout(() => {
//                         processRecordingAudio();
//                     }, 1000);
//                 } else {
//                     if (response.error === 'no_speech') {
//                         showError('No speech detected. Please speak in Pashto during recording.');
//                     } else {
//                         showError(response.error || 'Upload failed');
//                     }
//                     resetProcessingState();
//                 }
//             },
//             error: function(xhr) {
//                 let error = 'Network error occurred';
//                 if (xhr.responseJSON && xhr.responseJSON.error) {
//                     error = xhr.responseJSON.error;
//                 } else if (xhr.statusText) {
//                     error = xhr.statusText;
//                 }
//                 showError(error);
//                 resetProcessingState();
//             }
//         });
//     }
    
//     function processRecordingAudio() {
//         updateProcessingStep(2, 'active', 'Hybrid AI Processing...');
//         updateProgressDetail('Multi-model pipeline: ASR → Ollama Translation → Gemini Answer...');
        
//         $.ajax({
//             url: '/process-recording',
//             type: 'POST',
//             success: function(response) {
//                 if (response.success) {
//                     updateProcessingStep(2, 'completed', 'Processing complete');
//                     updateProcessingStep(3, 'active', 'Finalizing results...');
//                     updateProgressDetail('Finalizing processing results...');
                    
//                     // Update UI with results
//                     updateRecordingResults(response.data);
//                     setupRecordingAudioPlayers(response.timestamp);
                    
//                     // Update current settings
//                     currentTimestamp = response.timestamp;
//                     currentSourceType = response.source_type || 'recording';
//                     updateSettingsDisplay();
                    
//                     // Update source type and badges
//                     $('#sourceType').text('Live Recording');
//                     $('#sourceIcon').removeClass().addClass('fas fa-microphone');
//                     $('#currentTimestamp').text(response.timestamp);
                    
//                     // Update UI for recording vs upload
//                     updateUIForSourceType(currentSourceType);
                    
//                     // Complete the process
//                     setTimeout(() => {
//                         updateProcessingStep(3, 'completed', 'Results ready');
//                         updateProcessingStep(4, 'active', 'Loading audio...');
//                         updateProgressDetail('Loading generated audio files...');
                        
//                         setTimeout(() => {
//                             updateProcessingStep(4, 'completed', 'Audio loaded successfully');
//                             updateProgressDetail('Hybrid AI processing completed successfully!');
//                             $('#progressBar').css('width', '100%');
                            
//                             // Show success message
//                             setTimeout(() => {
//                                 $('#progressCard').addClass('d-none');
//                                 $('#resultsCard').removeClass('d-none');
//                                 showStatus('Recording processed successfully through hybrid AI pipeline!');
                                
//                                 // Scroll to results
//                                 $('html, body').animate({
//                                     scrollTop: $('#resultsCard').offset().top - 20
//                                 }, 500);
                                
//                                 // Reset processing state
//                                 resetProcessingState();
//                             }, 1000);
//                         }, 1500);
//                     }, 1000);
//                 } else {
//                     showError(response.error || 'Processing failed');
//                     resetProcessingState();
//                 }
//             },
//             error: function(xhr) {
//                 let error = 'Processing error occurred';
//                 if (xhr.responseJSON && xhr.responseJSON.error) {
//                     error = xhr.responseJSON.error;
//                 }
//                 showError(error);
//                 resetProcessingState();
//             }
//         });
//     }
    
//     // Upload form submission
//     $('#uploadForm').on('submit', function(e) {
//         e.preventDefault();
        
//         // Check if processing is active
//         if (isProcessing) {
//             showError('Processing is active. Please stop it first or wait for it to complete.');
//             return;
//         }
        
//         const formData = new FormData(this);
//         const uploadBtn = $('#uploadBtn');
//         const fileInput = $('#audioFile')[0];
        
//         // Validate file
//         if (!fileInput.files.length) {
//             showError('Please select an audio file');
//             return;
//         }
        
//         // Set processing flag
//         isProcessing = true;
//         currentProcessing = true;
        
//         // Reset players
//         resetAudioPlayers();
        
//         // Reset and show progress
//         resetProcessingSteps();
//         $('#progressCard').removeClass('d-none');
//         $('#resultsCard').addClass('d-none');
//         $('#errorAlert').addClass('d-none');
//         $('#statusAlert').addClass('d-none');
//         $('#progressText').text('Processing Through Hybrid AI Pipeline...');
        
//         // Start processing timer
//         startProcessingTimer();
        
//         // Update step 1
//         updateProcessingStep(1, 'active', 'Uploading audio file...');
//         updateProgressDetail('Uploading your audio file to server...');
        
//         // Disable button and show loading
//         const originalText = uploadBtn.html();
//         uploadBtn.prop('disabled', true);
//         uploadBtn.html('<i class="fas fa-spinner fa-spin me-2"></i>Processing...');
        
//         // Store current settings
//         currentVoice = $('#uploadVoiceSelect').val();
        
//         // Show cancel button
//         $('#cancelUploadBtn').removeClass('d-none');
        
//         // Upload audio file
//         $.ajax({
//             url: '/upload-audio',
//             type: 'POST',
//             data: formData,
//             processData: false,
//             contentType: false,
//             success: function(response) {
//                 if (response.success) {
//                     updateProcessingStep(1, 'completed', 'Uploaded successfully');
//                     updateProcessingStep(2, 'active', 'Starting hybrid AI pipeline...');
//                     updateProgressDetail('Processing through ASR → Translation → Answer Generation...');
                    
//                     // Store timestamp
//                     currentTimestamp = response.timestamp;
//                     currentSourceType = 'upload';
                    
//                     // Start processing with upload endpoint
//                     setTimeout(() => {
//                         processUploadAudio();
//                     }, 1000);
//                 } else {
//                     showError(response.error || 'Upload failed');
//                     resetProcessingState();
//                 }
//             },
//             error: function(xhr) {
//                 let error = 'Network error occurred';
//                 if (xhr.responseJSON && xhr.responseJSON.error) {
//                     error = xhr.responseJSON.error;
//                 } else if (xhr.statusText) {
//                     error = xhr.statusText;
//                 }
//                 showError(error);
//                 resetProcessingState();
//             }
//         });
//     });
    
//     function processUploadAudio() {
//         updateProcessingStep(2, 'active', 'Hybrid AI Processing...');
//         updateProgressDetail('Multi-model pipeline: ASR → Ollama Translation → Gemini Answer...');
        
//         $.ajax({
//             url: '/process-audio',
//             type: 'POST',
//             success: function(response) {
//                 if (response.success) {
//                     updateProcessingStep(2, 'completed', 'Processing complete');
//                     updateProcessingStep(3, 'active', 'Finalizing results...');
//                     updateProgressDetail('Finalizing processing results...');
                    
//                     // Update UI with results
//                     updateUploadResults(response.data);
//                     setupUploadAudioPlayers(response.timestamp);
                    
//                     // Update current settings
//                     currentTimestamp = response.timestamp;
//                     currentSourceType = response.source_type || 'upload';
//                     updateSettingsDisplay();
                    
//                     // Update source type and badges
//                     $('#sourceType').text('File Upload');
//                     $('#sourceIcon').removeClass().addClass('fas fa-upload');
//                     $('#currentTimestamp').text(response.timestamp);
                    
//                     // Update UI for upload
//                     updateUIForSourceType(currentSourceType);
                    
//                     // Complete the process
//                     setTimeout(() => {
//                         updateProcessingStep(3, 'completed', 'Results ready');
//                         updateProcessingStep(4, 'active', 'Loading audio...');
//                         updateProgressDetail('Loading generated audio files...');
                        
//                         setTimeout(() => {
//                             updateProcessingStep(4, 'completed', 'Audio loaded successfully');
//                             updateProgressDetail('Hybrid AI processing completed successfully!');
//                             $('#progressBar').css('width', '100%');
                            
//                             // Show success message
//                             setTimeout(() => {
//                                 $('#progressCard').addClass('d-none');
//                                 $('#resultsCard').removeClass('d-none');
//                                 showStatus('Processing completed through hybrid AI pipeline!');
                                
//                                 // Scroll to results
//                                 $('html, body').animate({
//                                     scrollTop: $('#resultsCard').offset().top - 20
//                                 }, 500);
                                
//                                 // Reset processing state
//                                 resetProcessingState();
//                             }, 1000);
//                         }, 1500);
//                     }, 1000);
//                 } else {
//                     showError(response.error || 'Processing failed');
//                     resetProcessingState();
//                 }
//             },
//             error: function(xhr) {
//                 let error = 'Processing error occurred';
//                 if (xhr.responseJSON && xhr.responseJSON.error) {
//                     error = xhr.responseJSON.error;
//                 }
//                 showError(error);
//                 resetProcessingState();
//             }
//         });
//     }
    
//     // -----------------------------
//     // AUDIO PLAYER FUNCTIONS
//     // -----------------------------
    
//     function setupAudioPlayerEvents(type, audioElement) {
//         const playerStatusId = type === 'question' ? 'questionPlayerStatus' : 'answerPlayerStatus';
//         const progressBarId = type === 'question' ? 'questionProgress' : 'answerProgress';
//         const progressBarContainerId = type === 'question' ? 'questionProgressBar' : 'answerProgressBar';
//         const currentTimeId = type === 'question' ? 'currentQuestionTime' : 'currentAnswerTime';
//         const totalTimeId = type === 'question' ? 'totalQuestionTime' : 'totalAnswerTime';
//         const playBtnId = type === 'question' ? 'playQuestionBtn' : 'playAnswerBtn';
//         const textElementId = type === 'question' ? 'pashtoQuestionText' : 'pashtoAnswerText';
        
//         // Reset text highlighting
//         resetTextHighlighting(type);
        
//         // Update time display when metadata is loaded
//         audioElement.addEventListener('loadedmetadata', function() {
//             const duration = audioElement.duration;
//             if (duration && duration > 0) {
//                 $(`#${totalTimeId}`).text(formatTime(duration));
//             } else {
//                 $(`#${totalTimeId}`).text('0:00');
//             }
//         });
        
//         // Update progress during playback
//         audioElement.addEventListener('timeupdate', function() {
//             const currentTime = audioElement.currentTime;
//             const duration = audioElement.duration || 1;
//             const progressPercent = (currentTime / duration) * 100;
            
//             $(`#${progressBarId}`).css('width', progressPercent + '%');
//             $(`#${currentTimeId}`).text(formatTime(currentTime));
            
//             // Update text highlighting
//             if (currentPlayer === audioElement && currentTextType === type) {
//                 updateTextHighlighting(type, currentTime, duration);
//             }
//         });
        
//         // Handle playback end
//         audioElement.addEventListener('ended', function() {
//             $(`#${playerStatusId}`).text('Completed').removeClass('playing paused').addClass('stopped');
            
//             // Reset play button
//             $(`#${playBtnId}`).find('i').removeClass('fa-pause').addClass('fa-play');
            
//             // Mark all words as spoken
//             $(`#${textElementId} .highlight-word`)
//                 .removeClass('current-word')
//                 .addClass('spoken-word');
            
//             isPlaying = false;
//             currentPlayer = null;
//             currentTextType = null;
//         });
        
//         // Handle play event
//         audioElement.addEventListener('play', function() {
//             $(`#${playerStatusId}`).text('Playing').removeClass('stopped paused').addClass('playing');
            
//             isPlaying = true;
//             currentPlayer = audioElement;
//             currentTextType = type;
            
//             // Update play button
//             $(`#${playBtnId}`).find('i').removeClass('fa-play').addClass('fa-pause');
            
//             // Stop other audio if playing
//             if (type === 'question' && !answerAudio.paused) {
//                 answerAudio.pause();
//                 answerAudio.currentTime = 0;
//                 resetAudioControl('answer');
//             } else if (type === 'answer' && !questionAudio.paused) {
//                 questionAudio.pause();
//                 questionAudio.currentTime = 0;
//                 resetAudioControl('question');
//             }
//         });
        
//         // Handle pause event
//         audioElement.addEventListener('pause', function() {
//             if (!audioElement.ended) {
//                 $(`#${playerStatusId}`).text('Paused').removeClass('playing').addClass('paused');
//             }
//             isPlaying = false;
            
//             // Update play button
//             $(`#${playBtnId}`).find('i').removeClass('fa-pause').addClass('fa-play');
//         });
        
//         // Click progress bar to seek
//         $(`#${progressBarContainerId}`).on('click', function(e) {
//             if (audioElement.duration) {
//                 const progressBar = $(this);
//                 const clickPosition = e.pageX - progressBar.offset().left;
//                 const progressBarWidth = progressBar.width();
//                 const percentage = (clickPosition / progressBarWidth);
                
//                 audioElement.currentTime = audioElement.duration * percentage;
                
//                 if (currentPlayer === audioElement) {
//                     updateTextHighlighting(type, audioElement.currentTime, audioElement.duration);
//                 }
//             }
//         });
//     }
    
//     // Audio control event handlers
//     $('#playQuestionBtn').on('click', function() {
//         if (questionAudio.paused) {
//             questionAudio.play().catch(e => {
//                 showError('Failed to play audio: ' + e.message);
//             });
//         } else {
//             questionAudio.pause();
//         }
//     });
    
//     $('#pauseQuestionBtn').on('click', function() {
//         if (!questionAudio.paused) {
//             questionAudio.pause();
//         }
//     });
    
//     $('#stopQuestionBtn').on('click', function() {
//         questionAudio.pause();
//         questionAudio.currentTime = 0;
//         resetAudioControl('question');
//     });
    
//     $('#playAnswerBtn').on('click', function() {
//         if (answerAudio.paused) {
//             answerAudio.play().catch(e => {
//                 showError('Failed to play audio: ' + e.message);
//             });
//         } else {
//             answerAudio.pause();
//         }
//     });
    
//     $('#pauseAnswerBtn').on('click', function() {
//         if (!answerAudio.paused) {
//             answerAudio.pause();
//         }
//     });
    
//     $('#stopAnswerBtn').on('click', function() {
//         answerAudio.pause();
//         answerAudio.currentTime = 0;
//         resetAudioControl('answer');
//     });
    
//     // Volume controls
//     $('#questionVolume').on('input', function() {
//         questionAudio.volume = $(this).val() / 100;
//     });
    
//     $('#answerVolume').on('input', function() {
//         answerAudio.volume = $(this).val() / 100;
//     });
    
//     // -----------------------------
//     // TEXT PROCESSING FUNCTIONS
//     // -----------------------------
    
//     function formatPashtoText(elementId, text) {
//         const container = $('#' + elementId);
//         container.empty();
        
//         if (!text || text === 'Not available' || text === 'Transcription failed') {
//             container.html('<span class="text-muted placeholder-text">' + (text || 'Text not available') + '</span>');
//             return;
//         }
        
//         // Split text into words and create highlighted elements
//         const words = text.split(/\s+/);
//         words.forEach((word, index) => {
//             if (word.trim()) {
//                 const span = $('<span>')
//                     .addClass('highlight-word')
//                     .attr('data-word-index', index)
//                     .text(word + ' ');
//                 container.append(span);
//             }
//         });
//     }
    
//     function updateTextHighlighting(type, currentTime, duration) {
//         const textElementId = type === 'question' ? 'pashtoQuestionText' : 'pashtoAnswerText';
//         const words = $(`#${textElementId} .highlight-word`);
        
//         if (words.length === 0) return;
        
//         // Calculate word index based on current time
//         const wordDuration = duration / words.length;
//         const newWordIndex = Math.min(Math.floor(currentTime / wordDuration), words.length - 1);
        
//         // Update highlighting
//         words.removeClass('current-word');
        
//         // Mark previous words as spoken
//         for (let i = 0; i < newWordIndex; i++) {
//             $(words[i]).addClass('spoken-word')
//                 .removeClass('current-word');
//         }
        
//         // Remove spoken class from current and future words
//         for (let i = newWordIndex; i < words.length; i++) {
//             $(words[i]).removeClass('spoken-word');
//         }
        
//         // Highlight current word
//         if (newWordIndex < words.length && newWordIndex >= 0) {
//             $(words[newWordIndex]).addClass('current-word');
//             wordIndex = newWordIndex;
            
//             // Scroll word into view if needed
//             const wordElement = words[newWordIndex];
//             const container = $(`#${textElementId}`).parent();
//             const wordTop = $(wordElement).position().top;
//             const containerTop = container.scrollTop();
//             const containerHeight = container.height();
            
//             if (wordTop < containerTop || wordTop > containerTop + containerHeight - 30) {
//                 container.animate({
//                     scrollTop: wordTop - 10
//                 }, 300);
//             }
//         }
//     }
    
//     function resetTextHighlighting(type) {
//         const textElementId = type === 'question' ? 'pashtoQuestionText' : 'pashtoAnswerText';
//         $(`#${textElementId} .highlight-word`)
//             .removeClass('current-word spoken-word');
//         wordIndex = 0;
//     }
    
//     function resetAudioControl(type) {
//         const playerStatusId = type === 'question' ? 'questionPlayerStatus' : 'answerPlayerStatus';
//         const progressBarId = type === 'question' ? 'questionProgress' : 'answerProgress';
//         const currentTimeId = type === 'question' ? 'currentQuestionTime' : 'currentAnswerTime';
//         const playBtnId = type === 'question' ? 'playQuestionBtn' : 'playAnswerBtn';
//         const totalTimeId = type === 'question' ? 'totalQuestionTime' : 'totalAnswerTime';
        
//         $(`#${playerStatusId}`).text('Stopped').removeClass('playing paused').addClass('stopped');
//         $(`#${progressBarId}`).css('width', '0%');
//         $(`#${currentTimeId}`).text('0:00');
//         $(`#${totalTimeId}`).text('0:00');
//         $(`#${playBtnId}`).find('i').removeClass('fa-pause').addClass('fa-play');
        
//         resetTextHighlighting(type);
//     }
    
//     function formatTime(seconds) {
//         if (isNaN(seconds) || seconds === Infinity) return "0:00";
        
//         const mins = Math.floor(seconds / 60);
//         const secs = Math.floor(seconds % 60);
//         return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
//     }
    
//     // -----------------------------
//     // UI UPDATE FUNCTIONS
//     // -----------------------------
    
//     function updateRecordingResults(data) {
//         const pashtoQuestion = data.pashto_question || 'Transcription not available';
//         const englishQuestion = data.english_question || 'Translation not available';
//         const pashtoAnswer = data.pashto_answer || 'Answer not available';
//         const englishAnswer = data.english_answer || 'Answer translation not available';
        
//         // Format Pashto text with highlighting
//         formatPashtoText('pashtoQuestionText', pashtoQuestion);
//         $('#englishQuestionText').text(englishQuestion);
//         formatPashtoText('pashtoAnswerText', pashtoAnswer);
//         $('#englishAnswerText').text(englishAnswer);
//     }
    
//     function updateUploadResults(data) {
//         const pashtoQuestion = data.pashto_question || 'Question not available';
//         const englishQuestion = data.english_question || 'Translation not available';
//         const pashtoAnswer = data.pashto_answer || 'Answer not available';
//         const englishAnswer = data.english_answer || 'Answer translation not available';
        
//         // Format Pashto text with highlighting
//         formatPashtoText('pashtoQuestionText', pashtoQuestion);
//         $('#englishQuestionText').text(englishQuestion);
//         formatPashtoText('pashtoAnswerText', pashtoAnswer);
//         $('#englishAnswerText').text(englishAnswer);
//     }
    
//     function updateUIForSourceType(sourceType) {
//         if (sourceType === 'recording') {
//             $('#recordingModeBadge').removeClass('d-none');
//             $('#uploadModeBadge').addClass('d-none');
//             $('#sourceIcon').removeClass().addClass('fas fa-microphone');
//             $('#sourceType').text('Live Recording');
//         } else {
//             $('#uploadModeBadge').removeClass('d-none');
//             $('#recordingModeBadge').addClass('d-none');
//             $('#sourceIcon').removeClass().addClass('fas fa-upload');
//             $('#sourceType').text('File Upload');
//         }
        
//         // Enable answer audio controls
//         $('#regenerateAnswerBtn').removeClass('d-none');
//         $('#downloadAnswerBtn').removeClass('d-none');
//         $('#downloadAnswerFullBtn').removeClass('d-none');
        
//         // Enable answer player controls
//         $('#playAnswerBtn').prop('disabled', false);
//         $('#pauseAnswerBtn').prop('disabled', false);
//         $('#stopAnswerBtn').prop('disabled', false);
//         $('#answerVolume').prop('disabled', false);
        
//         // Update answer audio player UI
//         $('#answerAudioPlayer').removeClass('bg-light').css('opacity', '1');
//         $('#answerPlayerStatus').text('Stopped').removeClass('playing paused').addClass('stopped');
        
//         // Update labels
//         $('.result-card-header h4').each(function() {
//             if ($(this).text().includes('Pashto Answer')) {
//                 $(this).html('<i class="fas fa-comment-dots me-2"></i>Pashto Answer <span class="badge bg-white text-primary float-end ms-2" id="answerStatus">Ready</span>');
//             }
//         });
        
//         // Update download section text
//         $('.download-btn[data-type="audio_pashto_question"]').html('<i class="fas fa-file-audio me-2"></i>Question Audio');
        
//         // Show regenerate all button
//         $('#regenerateAllAudioBtn').prop('disabled', false).removeClass('d-none');
//     }
    
//     function setupRecordingAudioPlayers(timestamp) {
//         currentTimestamp = timestamp;
//         sessionStorage.setItem('currentTimestamp', timestamp);
//         sessionStorage.setItem('sourceType', 'recording');
        
//         // Set up question audio with cache busting
//         questionAudio.src = `/download/audio_pashto_question?timestamp=${timestamp}&_=${Date.now()}`;
        
//         // Set up answer audio with cache busting
//         answerAudio.src = `/download/audio_pashto_answer?timestamp=${timestamp}&_=${Date.now()}`;
        
//         // Update UI for recording mode
//         updateUIForSourceType('recording');
//     }
    
//     function setupUploadAudioPlayers(timestamp) {
//         currentTimestamp = timestamp;
//         sessionStorage.setItem('currentTimestamp', timestamp);
//         sessionStorage.setItem('sourceType', 'upload');
        
//         // Set up question audio with cache busting
//         questionAudio.src = `/download/audio_pashto_question?timestamp=${timestamp}&_=${Date.now()}`;
        
//         // Set up answer audio with cache busting
//         answerAudio.src = `/download/audio_pashto_answer?timestamp=${timestamp}&_=${Date.now()}`;
        
//         // Update UI for upload mode
//         updateUIForSourceType('upload');
//     }
    
//     function updateSettingsDisplay() {
//         const voiceSelect = $('#recordVoiceSelect');
//         const selectedVoice = voiceSelect.find('option:selected');
//         const voiceName = selectedVoice.text().split(' - ')[0];
//         $('#currentSettings').text(`Hybrid AI System | TTS: ${voiceName}`);
//     }
    
//     // -----------------------------
//     // PROCESSING CONTROLS
//     // -----------------------------
    
//     // Stop processing button
//     $('#stopProcessingBtn').on('click', function() {
//         stopProcessing();
//     });
    
//     // Stop progress button
//     $('#stopProgressBtn').on('click', function() {
//         stopProcessing();
//     });
    
//     function stopProcessing() {
//         $.ajax({
//             url: '/stop-processing',
//             type: 'POST',
//             success: function(response) {
//                 if (response.success) {
//                     showStatus('Processing stopped. You can now upload new audio or record again.');
                    
//                     // Hide progress card and processing control
//                     $('#progressCard').addClass('d-none');
//                     $('#processingControlCard').addClass('d-none');
                    
//                     // Reset processing state
//                     isProcessing = false;
//                     currentProcessing = false;
                    
//                     // Reset buttons
//                     resetButtons();
                    
//                     // Reset processing timer
//                     stopProcessingTimer();
                    
//                     // Enable tabs and buttons
//                     $('.nav-tabs .nav-link').prop('disabled', false);
//                     $('.btn:not(#stopProcessingBtn)').prop('disabled', false);
                    
//                     // Clear any recording
//                     resetRecording();
                    
//                     // Scroll to top
//                     $('html, body').animate({
//                         scrollTop: 0
//                     }, 500);
//                 } else {
//                     showError(response.error || 'Failed to stop processing');
//                 }
//             },
//             error: function() {
//                 showError('Failed to stop processing');
//             }
//         });
//     }
    
//     function updateProcessingTime() {
//         if (!processingStartTime) return;
        
//         const elapsedSeconds = Math.floor((Date.now() - processingStartTime) / 1000);
//         const minutes = Math.floor(elapsedSeconds / 60);
//         const seconds = elapsedSeconds % 60;
        
//         $('#timeElapsed').text(`Time elapsed: ${minutes}m ${seconds}s`);
//     }
    
//     function startProcessingTimer() {
//         processingStartTime = Date.now();
//         processingTimer = setInterval(updateProcessingTime, 1000);
//     }
    
//     function stopProcessingTimer() {
//         if (processingTimer) {
//             clearInterval(processingTimer);
//             processingTimer = null;
//         }
//         processingStartTime = null;
//     }
    
//     function updateProcessingStep(stepNumber, status, message = '') {
//         const step = $('#step' + stepNumber);
//         const stepStatus = step.find('.step-status');
        
//         step.removeClass('active completed');
        
//         if (status === 'active') {
//             step.addClass('active');
//             stepStatus.text(message || 'In progress...');
            
//             // Update progress bar
//             const progressPercent = (stepNumber - 1) * 25 + 25;
//             $('#progressBar').css('width', progressPercent + '%');
            
//             // Update previous steps
//             for (let i = 1; i < stepNumber; i++) {
//                 $('#step' + i).addClass('completed');
//                 $('#step' + i + ' .step-line').addClass('completed');
//             }
//         } else if (status === 'completed') {
//             step.addClass('completed');
//             stepStatus.text(message || 'Completed');
//         } else if (status === 'pending') {
//             stepStatus.text('');
//         }
//     }
    
//     function updateProgressDetail(message) {
//         $('#progressDetail').text(message);
//     }
    
//     function resetProcessingSteps() {
//         for (let i = 1; i <= 4; i++) {
//             const step = $('#step' + i);
//             step.removeClass('active completed');
//             step.find('.step-status').text('');
//             step.find('.step-line').removeClass('completed');
//         }
//         $('#progressBar').css('width', '0%');
//         $('#timeElapsed').text('Time elapsed: 0s');
//     }
    
//     function resetProcessingState() {
//         isProcessing = false;
//         currentProcessing = false;
        
//         // Reset recording button
//         $('#processRecordingBtn').prop('disabled', true).html('<i class="fas fa-play-circle me-2"></i>Process Recording');
        
//         // Reset upload button
//         $('#uploadBtn').prop('disabled', false).html('<i class="fas fa-upload me-2"></i> Upload & Process');
        
//         // Hide cancel buttons
//         $('#cancelRecordingBtn').addClass('d-none');
//         $('#cancelUploadBtn').addClass('d-none');
        
//         // Stop processing timer
//         stopProcessingTimer();
//     }
    
//     function resetButtons() {
//         // Reset recording buttons
//         $('#processRecordingBtn').prop('disabled', true).html('<i class="fas fa-play-circle me-2"></i>Process Recording');
//         $('#startRecordingBtn').removeClass('d-none');
//         $('#stopRecordingBtn').addClass('d-none');
//         $('#playRecordingBtn').addClass('d-none');
//         $('#reRecordBtn').addClass('d-none');
//         $('#cancelRecordingBtn').addClass('d-none');
        
//         // Reset upload buttons
//         $('#uploadBtn').prop('disabled', false).html('<i class="fas fa-upload me-2"></i> Upload & Process');
//         $('#cancelUploadBtn').addClass('d-none');
        
//         // Reset progress button
//         $('#stopProgressBtn').prop('disabled', false).html('<i class="fas fa-stop me-2"></i>Stop Processing');
        
//         // Reset processing control button
//         $('#stopProcessingBtn').prop('disabled', false).html('<i class="fas fa-stop me-1"></i>Stop Processing');
        
//         // Reset regenerate all button
//         $('#regenerateAllAudioBtn').prop('disabled', false).removeClass('d-none');
        
//         // Enable all buttons
//         $('.btn').prop('disabled', false);
//     }
    
//     function resetAudioPlayers() {
//         // Stop all audio
//         if (questionAudio) {
//             questionAudio.pause();
//             questionAudio.currentTime = 0;
//         }
//         if (answerAudio) {
//             answerAudio.pause();
//             answerAudio.currentTime = 0;
//         }
        
//         // Reset UI
//         resetAudioControl('question');
//         resetAudioControl('answer');
        
//         // Clear sources
//         if (questionAudio) questionAudio.src = '';
//         if (answerAudio) answerAudio.src = '';
        
//         isPlaying = false;
//         currentPlayer = null;
//         currentTextType = null;
//         wordIndex = 0;
//     }
    
//     // -----------------------------
//     // DOWNLOAD & REGENERATION
//     // -----------------------------
    
//     // Download buttons
//     $(document).on('click', '.download-btn', function(e) {
//         e.preventDefault();
//         const fileType = $(this).data('type');
//         const timestamp = currentTimestamp || sessionStorage.getItem('currentTimestamp');
        
//         if (fileType.includes('audio_') && timestamp) {
//             window.open(`/download/${fileType}?timestamp=${timestamp}&_=${Date.now()}`, '_blank');
//         } else if (fileType === 'text') {
//             window.open(`/download/${fileType}`, '_blank');
//         } else {
//             window.open(`/download/${fileType}`, '_blank');
//         }
//     });
    
//     $('#downloadRecordingBtn').on('click', function() {
//         const timestamp = currentTimestamp || sessionStorage.getItem('currentTimestamp');
//         if (timestamp) {
//             window.open(`/download/recording?timestamp=${timestamp}&_=${Date.now()}`, '_blank');
//         }
//     });
    
//     // Regenerate audio buttons
//     $(document).on('click', '.regenerate-audio-btn', function(e) {
//         e.preventDefault();
//         currentAudioType = $(this).data('type');
        
//         // Update modal text based on audio type
//         const audioTypeText = currentAudioType === 'pashto_question' ? 'question' : 'answer';
//         $('#regenerateModalText').text(`Generate new Pashto ${audioTypeText} audio using current text?`);
        
//         // Show confirmation modal
//         $('#regenerateModal').modal('show');
//     });
    
//     $('#regenerateAllAudioBtn').on('click', function(e) {
//         e.preventDefault();
//         currentAudioType = 'all';
        
//         // Update modal text
//         $('#regenerateModalText').text('Generate new Pashto question and answer audio using current text?');
        
//         // Show confirmation modal
//         $('#regenerateModal').modal('show');
//     });
    
//     // Confirm regenerate audio
//     $('#confirmRegenerateBtn').on('click', function() {
//         $('#regenerateModal').modal('hide');
        
//         if (!currentAudioType) return;
        
//         // Show loading state
//         const originalText = $(this).html();
//         $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-2"></i>Regenerating...');
        
//         $.ajax({
//             url: `/regenerate-audio/${currentAudioType}`,
//             type: 'POST',
//             success: function(response) {
//                 if (response.success) {
//                     showStatus(response.message);
                    
//                     // Reload audio players
//                     if (currentTimestamp) {
//                         setTimeout(() => {
//                             questionAudio.src = `/download/audio_pashto_question?timestamp=${currentTimestamp}&_=${Date.now()}`;
//                             answerAudio.src = `/download/audio_pashto_answer?timestamp=${currentTimestamp}&_=${Date.now()}`;
                            
//                             // Reset audio controls
//                             resetAudioControl('question');
//                             resetAudioControl('answer');
//                         }, 500);
//                     }
//                 } else {
//                     showError(response.error || 'Failed to regenerate audio');
//                 }
//                 $('#confirmRegenerateBtn').prop('disabled', false).html(originalText);
//             },
//             error: function(xhr) {
//                 let error = 'Network error occurred';
//                 if (xhr.responseJSON && xhr.responseJSON.error) {
//                     error = xhr.responseJSON.error;
//                 }
//                 showError(error);
//                 $('#confirmRegenerateBtn').prop('disabled', false).html(originalText);
//             }
//         });
//     });
    
//     // Replace audio functionality
//     $('#confirmReplaceBtn').on('click', function() {
//         const formData = new FormData($('#replaceAudioForm')[0]);
//         const fileInput = $('#replaceAudioFile')[0];
        
//         if (!fileInput.files.length) {
//             showError('Please select an audio file to replace');
//             return;
//         }
        
//         // Show loading state
//         const originalText = $(this).html();
//         $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-2"></i>Processing...');
        
//         $.ajax({
//             url: '/replace-audio',
//             type: 'POST',
//             data: formData,
//             processData: false,
//             contentType: false,
//             success: function(response) {
//                 if (response.success) {
//                     $('#replaceModal').modal('hide');
//                     showStatus('Audio replaced successfully. Processing...');
                    
//                     // Reset and show progress
//                     resetProcessingSteps();
//                     $('#progressCard').removeClass('d-none');
//                     $('#resultsCard').addClass('d-none');
                    
//                     // Start processing timer
//                     startProcessingTimer();
                    
//                     // Update step 1
//                     updateProcessingStep(1, 'active', 'Uploading new audio...');
//                     updateProgressDetail('Processing new audio file through hybrid AI pipeline...');
                    
//                     // Process the new audio
//                     setTimeout(() => {
//                         processUploadAudio();
//                     }, 500);
//                 } else {
//                     showError(response.error || 'Failed to replace audio');
//                 }
//                 $('#confirmReplaceBtn').prop('disabled', false).html(originalText);
//             },
//             error: function(xhr) {
//                 let error = 'Network error occurred';
//                 if (xhr.responseJSON && xhr.responseJSON.error) {
//                     error = xhr.responseJSON.error;
//                 }
//                 showError(error);
//                 $('#confirmReplaceBtn').prop('disabled', false).html(originalText);
//             }
//         });
//     });
    
//     // Clear session button
//     $('#clearBtn').on('click', function() {
//         if (confirm('Are you sure you want to clear all results and start over? This will delete all files.')) {
//             resetAudioPlayers();
            
//             $.ajax({
//                 url: '/clear-session',
//                 type: 'POST',
//                 success: function(response) {
//                     if (response.success) {
//                         $('#resultsCard').addClass('d-none');
//                         $('#uploadForm')[0].reset();
//                         showStatus('Session cleared. You can now upload a new audio file or start recording.');
                        
//                         // Reset settings
//                         currentVoice = 'ps';
//                         currentTimestamp = '';
//                         currentSourceType = '';
//                         sessionStorage.removeItem('currentTimestamp');
//                         sessionStorage.removeItem('sourceType');
//                         window.recordedAudioBlob = null;
                        
//                         // Reset recording UI
//                         resetRecording();
                        
//                         // Reset processing state
//                         isProcessing = false;
//                         currentProcessing = false;
                        
//                         // Stop processing timer
//                         stopProcessingTimer();
                        
//                         // Reset progress steps
//                         resetProcessingSteps();
                        
//                         // Scroll to top
//                         $('html, body').animate({
//                             scrollTop: 0
//                         }, 500);
//                     } else {
//                         showError(response.error || 'Failed to clear session');
//                     }
//                 },
//                 error: function() {
//                     showError('Failed to clear session');
//                 }
//             });
//         }
//     });
    
//     // -----------------------------
//     // ERROR & STATUS HANDLING
//     // -----------------------------
    
//     function showError(message) {
//         $('#errorAlert').html(`
//             <div class="d-flex align-items-center">
//                 <i class="fas fa-exclamation-circle me-3" style="font-size: 1.5rem;"></i>
//                 <div>${message}</div>
//             </div>
//         `).removeClass('d-none');
        
//         $('#progressCard').addClass('d-none');
//         scrollToElement('#errorAlert');
        
//         // Auto-hide after 10 seconds
//         setTimeout(() => {
//             $('#errorAlert').addClass('d-none');
//         }, 10000);
//     }
    
//     function showStatus(message) {
//         $('#statusAlert').html(`
//             <div class="d-flex align-items-center">
//                 <i class="fas fa-info-circle me-3" style="font-size: 1.5rem;"></i>
//                 <div>${message}</div>
//             </div>
//         `).removeClass('d-none');
        
//         // Auto-hide after 5 seconds
//         setTimeout(() => {
//             $('#statusAlert').addClass('d-none');
//         }, 5000);
//     }
    
//     function scrollToElement(selector) {
//         const element = $(selector);
//         if (element.length) {
//             $('html, body').animate({
//                 scrollTop: element.offset().top - 20
//             }, 500);
//         }
//     }
// });