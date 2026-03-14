  import React, { useRef, useEffect, useState, useMemo } from 'react';
  import Webcam from 'react-webcam';
  import { Hands, HAND_CONNECTIONS } from '@mediapipe/hands';
  import { Camera } from '@mediapipe/camera_utils';
  import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
  import './App.css';

  function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const canvasDrawingRef = useRef(null);
  const canvasWrapperRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(5);
    const [brushColor, setBrushColor] = useState('#ffffff');
    const [clearCanvas, setClearCanvas] = useState(false);
    const [smoothingLevel, setSmoothingLevel] = useState(5); // Increased default smoothing
    const [eraserMode, setEraserMode] = useState(false);
    const lastPositionRef = useRef(null);
    const isDrawingRef = useRef(false);
    const smoothingPointsRef = useRef([]);
    const cursorCanvasRef = useRef(null);
    const drawingStateTimeoutRef = useRef(null);
    const lastDistanceRef = useRef(0);
    const isNewStrokeRef = useRef(true);
    
    // Additional refs for jitter reduction
    const lastSmoothedPositionRef = useRef(null);
    const velocityRef = useRef({ x: 0, y: 0 });
    const strokePointsRef = useRef([]);
    const animationFrameRef = useRef(null);

    // Initialize MediaPipe Hands using useMemo to prevent recreation on every render
    const hands = useMemo(() => {
      const handsInstance = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      handsInstance.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      return handsInstance;
    }, []);

    // Apply smoothing to points using advanced filtering
    const applySmoothing = (x, y) => {
      // Add new point to the smoothing buffer
      smoothingPointsRef.current.push({ x, y });
      
      // Keep only the last 'smoothingLevel' points
      if (smoothingPointsRef.current.length > smoothingLevel) {
        smoothingPointsRef.current.shift();
      }
      
      // Calculate simple moving average
      const avgX = smoothingPointsRef.current.reduce((sum, point) => sum + point.x, 0) / smoothingPointsRef.current.length;
      const avgY = smoothingPointsRef.current.reduce((sum, point) => sum + point.y, 0) / smoothingPointsRef.current.length;
      
      // Apply velocity damping to reduce jitter
      if (lastSmoothedPositionRef.current) {
        const deltaX = avgX - lastSmoothedPositionRef.current.x;
        const deltaY = avgY - lastSmoothedPositionRef.current.y;
        
        // Calculate velocity
        velocityRef.current = {
          x: deltaX * 0.3 + velocityRef.current.x * 0.7, // Momentum factor
          y: deltaY * 0.3 + velocityRef.current.y * 0.7
        };
        
        // Apply velocity to smooth out sudden jumps
        const smoothedX = avgX + velocityRef.current.x * 0.2;
        const smoothedY = avgY + velocityRef.current.y * 0.2;
        
        lastSmoothedPositionRef.current = { x: smoothedX, y: smoothedY };
        return { x: smoothedX, y: smoothedY };
      }
      
      lastSmoothedPositionRef.current = { x: avgX, y: avgY };
      return { x: avgX, y: avgY };
    };

    // Drawing function with improved continuity and smoothing
    const drawOnCanvas = (x, y) => {
      const canvas = canvasDrawingRef.current;
      if (!canvas) return;
      
      // Apply smoothing to the coordinates
      const smoothedPoint = applySmoothing(x, y);
      const smoothX = smoothedPoint.x;
      const smoothY = smoothedPoint.y;
      
      const ctx = canvas.getContext('2d');
      
      // Save the current context state
      ctx.save();
      
      // Set all context properties at the beginning
      ctx.lineWidth = eraserMode ? 20 : brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = eraserMode ? '#000000' : brushColor;
      ctx.fillStyle = eraserMode ? '#000000' : brushColor;
      ctx.globalCompositeOperation = eraserMode ? 'destination-out' : 'source-over';
      
      console.log('Drawing with color:', brushColor, 'Eraser mode:', eraserMode, 'Stroke style:', ctx.strokeStyle, 'Fill style:', ctx.fillStyle);
      
      // Check if we should draw a line or start a new point
      if (isNewStrokeRef.current) {
        // Always start with a dot for new strokes
        ctx.beginPath();
        ctx.arc(smoothX, smoothY, eraserMode ? 10 : brushSize/2, 0, 2 * Math.PI);
        ctx.fill();
        isNewStrokeRef.current = false; // Mark that we've started this stroke
        console.log('Drawing dot at:', smoothX, smoothY);
      } 
      // Continue drawing within the same stroke
      else if (lastPositionRef.current && isDrawingRef.current) {
        // Draw a line from the last position to the current position
        ctx.beginPath();
        ctx.moveTo(lastPositionRef.current.x, lastPositionRef.current.y);
        ctx.lineTo(smoothX, smoothY);
        ctx.stroke();
        console.log('Drawing line from:', lastPositionRef.current.x, lastPositionRef.current.y, 'to:', smoothX, smoothY);
      } 
      // Fallback for any other case - start a new point
      else {
        ctx.beginPath();
        ctx.arc(smoothX, smoothY, eraserMode ? 10 : brushSize/2, 0, 2 * Math.PI);
        ctx.fill();
        isNewStrokeRef.current = false; // Mark that we've started this stroke
        console.log('Drawing fallback dot at:', smoothX, smoothY);
      }
      
      // Restore the context state
      ctx.restore();
      
      // Always update the last position with smoothed coordinates
      lastPositionRef.current = { x: smoothX, y: smoothY };
    };

    // Draw cursor on separate cursor canvas
    const drawCursor = (x, y, isDrawing) => {
      const cursorCanvas = cursorCanvasRef.current;
      const drawingCanvas = canvasDrawingRef.current;
      
      if (!cursorCanvas || !drawingCanvas) return;
      
      const ctx = cursorCanvas.getContext('2d');
      cursorCanvas.width = drawingCanvas.width;
      cursorCanvas.height = drawingCanvas.height;
      
      // Clear cursor canvas
      ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
      
      // Always draw a cursor dot that follows the index finger
      const radius = eraserMode ? 20 : 15;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isDrawing
        ? eraserMode
          ? 'rgba(239, 68, 68, 0.35)'
          : 'rgba(74, 222, 128, 0.35)'
        : 'rgba(200, 200, 200, 0.3)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Small center dot for exact contact point
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    };

    // Map MediaPipe landmark (normalized 0–1) into drawing canvas coordinates
    const mapLandmarkToCanvas = (landmark, drawingCanvas) => {
      // Mirror x (camera is mirrored) and use internal canvas resolution,
      // which is kept in sync with the displayed size via ResizeObserver.
      const x = (1 - landmark.x) * drawingCanvas.width;
      const y = landmark.y * drawingCanvas.height;
      return { x, y };
    };

    // Catmull-Rom spline interpolation helper
    const catmullRom = (p0, p1, p2, p3, t) => {
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

      const y =
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

      return { x, y };
    };

    // Handle results from MediaPipe - defined as a separate function
    const handleMediaPipeResults = (results) => {
      const video = webcamRef.current?.video;
      const canvas = canvasRef.current;
      const drawingCanvas = canvasDrawingRef.current;
      const cursorCanvas = cursorCanvasRef.current;
      
      if (!canvas || !video || !drawingCanvas || !cursorCanvas) return;
      
      const ctx = canvas.getContext('2d');
      canvas.width = 250;
      canvas.height = 250;
      
      // Clear camera canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw the webcam feed (correct mirroring)
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (const landmarks of results.multiHandLandmarks) {
          // Draw hand landmarks and connections on the camera canvas
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00f3ff', lineWidth: 2 });
          drawLandmarks(ctx, landmarks, { color: '#00f3ff', lineWidth: 1 });
          ctx.restore();
          
          // Get index finger tip (landmark 8) and map to drawing canvas space
          const indexFingerTip = landmarks[8];
          const { x, y } = mapLandmarkToCanvas(indexFingerTip, drawingCanvas);
          
          // Draw cursor on separate cursor canvas (always draw for smooth transition)
          drawCursor(x, y, isDrawingRef.current);
          
          // Get thumb tip (landmark 4) and map to drawing canvas space
          const thumbTip = landmarks[4];
          const { x: thumbX, y: thumbY } = mapLandmarkToCanvas(thumbTip, drawingCanvas);
          
          // Calculate distance between thumb and index finger
          const distance = Math.sqrt(Math.pow(thumbX - x, 2) + Math.pow(thumbY - y, 2));
          
          // Update last distance
          lastDistanceRef.current = distance;
          
          // State switching logic - immediate start, small delay when stopping
          if (distance < 40) {
            // Start drawing - immediate (no delay)
            if (!isDrawingRef.current) {
              // Clear any existing timeout
              if (drawingStateTimeoutRef.current) {
                clearTimeout(drawingStateTimeoutRef.current);
              }
              
              // Start drawing immediately
              lastPositionRef.current = null; // Reset last position for new line
              isDrawingRef.current = true;
              smoothingPointsRef.current = []; // Reset smoothing points for new line
              isNewStrokeRef.current = true; // Mark as new stroke
              strokePointsRef.current = [];
              setIsDrawing(true);
            }
            
            // Collect points for spline-based drawing
            if (isDrawingRef.current) {
              strokePointsRef.current.push({ x, y });
            }
          } else {
            // Stop drawing - small delay to prevent accidental triggers
            if (isDrawingRef.current) {
              // Clear any existing timeout
              if (drawingStateTimeoutRef.current) {
                clearTimeout(drawingStateTimeoutRef.current);
              }
              
              // Set timeout to stop drawing with small delay
              drawingStateTimeoutRef.current = setTimeout(() => {
                lastPositionRef.current = null;
                isDrawingRef.current = false;
                smoothingPointsRef.current = []; // Reset smoothing points when stopping
                isNewStrokeRef.current = true; // Mark as new stroke for next time
                strokePointsRef.current = [];
                setIsDrawing(false);
                lastSmoothedPositionRef.current = null; // Reset smoothed position when stopping
                velocityRef.current = { x: 0, y: 0 }; // Reset velocity when stopping
              }, 30); // Small 30ms delay when stopping drawing
            }
          }
          
          // Check for eraser gesture (fist)
          let isFist = true;
          for (let i = 8; i <= 20; i += 4) {
            if (landmarks[i].y < landmarks[0].y) {
              isFist = false;
              break;
            }
          }
          
          if (isFist) {
            clearDrawingCanvas();
          }
        }
      }
    };

    // Register MediaPipe callback - re-register when dependencies change
    useEffect(() => {
      hands.onResults(handleMediaPipeResults);
    }, [brushColor, brushSize, eraserMode, smoothingLevel, hands]);

    // Setup camera
    useEffect(() => {
      if (webcamRef.current && canvasRef.current) {
        const camera = new Camera(webcamRef.current.video, {
          onFrame: async () => {
            if (webcamRef.current?.video?.readyState === 4) {
              await hands.send({ image: webcamRef.current.video });
            }
          },
          width: 250,
          height: 250
        });
        camera.start();
      }
    }, [hands]);

    // Handle clear canvas
    useEffect(() => {
      if (clearCanvas) {
        clearDrawingCanvas();
        setClearCanvas(false);
      }
    }, [clearCanvas]);

    // Keep drawing & cursor canvases sized to their displayed size
    useEffect(() => {
      const wrapper = canvasWrapperRef.current;
      const drawingCanvas = canvasDrawingRef.current;
      const cursorCanvas = cursorCanvasRef.current;

      if (!wrapper || !drawingCanvas || !cursorCanvas) return;

      const resize = () => {
        const { offsetWidth, offsetHeight } = wrapper;
        if (!offsetWidth || !offsetHeight) return;

        drawingCanvas.width = offsetWidth;
        drawingCanvas.height = offsetHeight;

        cursorCanvas.width = offsetWidth;
        cursorCanvas.height = offsetHeight;
      };

      resize();

      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(resize);
        observer.observe(wrapper);

        return () => {
          observer.disconnect();
        };
      }

      // Fallback: resize on window resize if ResizeObserver is unavailable
      window.addEventListener('resize', resize);
      return () => {
        window.removeEventListener('resize', resize);
      };
    }, []);

    // Cleanup timeouts
    useEffect(() => {
      return () => {
        if (drawingStateTimeoutRef.current) {
          clearTimeout(drawingStateTimeoutRef.current);
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, []);

    // Drawing loop using requestAnimationFrame with Catmull-Rom stroke smoothing
    useEffect(() => {
      const drawLoop = () => {
        const canvas = canvasDrawingRef.current;
        if (canvas && isDrawingRef.current && strokePointsRef.current.length >= 4) {
          const ctx = canvas.getContext('2d');
          const points = strokePointsRef.current;

          ctx.save();
          ctx.lineWidth = eraserMode ? 20 : brushSize;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = eraserMode ? '#000000' : brushColor;
          ctx.fillStyle = eraserMode ? '#000000' : brushColor;
          ctx.globalCompositeOperation = eraserMode ? 'destination-out' : 'source-over';

          const step = 1 / (Math.max(2, smoothingLevel * 2));

          for (let i = 0; i < points.length - 3; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const p2 = points[i + 2];
            const p3 = points[i + 3];

            for (let t = 0; t <= 1; t += step) {
              const { x, y } = catmullRom(p0, p1, p2, p3, t);

              if (!lastPositionRef.current || isNewStrokeRef.current) {
                ctx.beginPath();
                ctx.arc(x, y, eraserMode ? 10 : brushSize / 2, 0, 2 * Math.PI);
                ctx.fill();
                isNewStrokeRef.current = false;
              } else {
                ctx.beginPath();
                ctx.moveTo(lastPositionRef.current.x, lastPositionRef.current.y);
                ctx.lineTo(x, y);
                ctx.stroke();
              }

              lastPositionRef.current = { x, y };
            }
          }

          ctx.restore();

          // Keep only the last few points so we don't redraw the full stroke every frame
          strokePointsRef.current = points.slice(-3);
        }

        animationFrameRef.current = requestAnimationFrame(drawLoop);
      };

      animationFrameRef.current = requestAnimationFrame(drawLoop);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [brushColor, brushSize, eraserMode, smoothingLevel]);

    // Test draw function to verify brush color
    const testDraw = () => {
      const canvas = canvasDrawingRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = brushColor;
      ctx.fillStyle = brushColor;
      ctx.globalCompositeOperation = 'source-over';
      
      // Draw a simple line to test the color
      ctx.beginPath();
      ctx.moveTo(50, 50);
      ctx.lineTo(200, 200);
      ctx.stroke();
      
      console.log('Test draw with color:', brushColor);
    };
    
    // Clear canvas
    const clearDrawingCanvas = () => {
      const canvas = canvasDrawingRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lastPositionRef.current = null;
      isDrawingRef.current = false;
      smoothingPointsRef.current = [];
      strokePointsRef.current = [];
      isNewStrokeRef.current = true;
    };

    // Save canvas as image
    const saveCanvasAsImage = () => {
      const canvas = canvasDrawingRef.current;
      if (!canvas) return;
      
      // Create a temporary canvas to combine the drawing with a white background
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      // Fill with white background
      tempCtx.fillStyle = '#000000';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      
      // Draw the actual canvas content on top
      tempCtx.drawImage(canvas, 0, 0);
      
      // Convert to data URL and trigger download
      const dataUrl = tempCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'hand-gesture-drawing.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    const gestureLabel = isDrawing
      ? eraserMode
        ? 'Erasing'
        : 'Drawing'
      : 'Idle';

    return (
      <div className="App">
        <div className="app-shell">
          <aside className="sidebar">
            <div className="sidebar-header">
              <div className="app-brand">
                <div className="app-logo-mark">
                  <span className="app-logo-glyph">✋</span>
                </div>
                <div className="app-title-block">
                  <h1>GestureCanvas</h1>
                  <p>Hands-free creative whiteboard</p>
                </div>
              </div>
            </div>

            <div className="gesture-status">
              <div
                className={`gesture-indicator ${
                  isDrawing ? (eraserMode ? 'eraser' : 'active') : 'idle'
                }`}
              />
              <div className="gesture-text">
                <span className="gesture-label">{gestureLabel}</span>
                <span className="gesture-sub">
                  {isDrawing
                    ? eraserMode
                      ? 'Pinch to erase on the board'
                      : 'Pinch to draw on the board'
                    : 'Raise your hand and pinch to start'}
                </span>
              </div>
            </div>

            <div className="controls">
              <div className="control-group">
                <label>
                  Brush Size
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  />
                  <span className="value-display">{brushSize}px</span>
                </label>
              </div>

              <div className="control-group">
                <label>
                  Brush Color
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => {
                      console.log('Color changed to:', e.target.value);
                      setBrushColor(e.target.value);
                    }}
                  />
                  <span
                    className="color-preview"
                    style={{
                      display: 'inline-block',
                      width: '20px',
                      height: '20px',
                      backgroundColor: brushColor,
                      border: '1px solid #ffffff',
                      marginLeft: '5px',
                      verticalAlign: 'middle'
                    }}
                  ></span>
                  <span style={{ marginLeft: '5px', fontSize: '0.8rem' }}>
                    {brushColor}
                  </span>
                </label>
              </div>

              <div className="control-group">
                <label>
                  Preset Colors
                  <div className="preset-colors">
                    {['#ffffff', '#cccccc', '#999999', '#666666', '#333333', '#000000'].map(
                      (color) => (
                        <button
                          key={color}
                          onClick={() => setBrushColor(color)}
                          style={{
                            width: '20px',
                            height: '20px',
                            backgroundColor: color,
                            border: '1px solid #ffffff',
                            cursor: 'pointer',
                            padding: 0
                          }}
                        />
                      )
                    )}
                  </div>
                </label>
              </div>

              <div className="control-group">
                <label>
                  Smoothing
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={smoothingLevel}
                    onChange={(e) => setSmoothingLevel(parseInt(e.target.value))}
                  />
                  <span className="value-display">{smoothingLevel}</span>
                </label>
              </div>

              <div className="control-group inline-control">
                <label>
                  <input
                    type="checkbox"
                    checked={eraserMode}
                    onChange={(e) => setEraserMode(e.target.checked)}
                  />
                  Eraser mode
                </label>
              </div>

              <div className="control-row">
                <button onClick={() => setClearCanvas(true)}>Clear</button>
                <button onClick={saveCanvasAsImage}>Save</button>
                <button onClick={testDraw}>Test</button>
              </div>
            </div>

          </aside>

          <main className="workspace">
            <div className="canvas-wrapper" ref={canvasWrapperRef}>
              <canvas
                ref={canvasDrawingRef}
                className="drawing-canvas"
              />
              <canvas
                ref={cursorCanvasRef}
                className="cursor-canvas"
              />

              <div className="camera-overlay">
                <Webcam
                  ref={webcamRef}
                  className="webcam-feed"
                  videoConstraints={{
                    facingMode: 'user',
                    width: 320,
                    height: 240
                  }}
                />
                <canvas
                  ref={canvasRef}
                  className="camera-canvas"
                  width={320}
                  height={240}
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  export default App;