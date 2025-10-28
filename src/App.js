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
    
    // Draw cursor only when not drawing
    if (!isDrawing) {
      ctx.beginPath();
      ctx.arc(x, y, eraserMode ? 20 : 15, 0, 2 * Math.PI);
      ctx.fillStyle = eraserMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(200, 200, 200, 0.3)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw a small dot in the center to show the exact point
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
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
        
        // Get index finger tip (landmark 8) - with correct mirroring for drawing canvas
        const indexFingerTip = landmarks[8];
        const x = (1 - indexFingerTip.x) * drawingCanvas.width;
        const y = indexFingerTip.y * drawingCanvas.height;
        
        // Draw cursor on separate cursor canvas (always draw for smooth transition)
        drawCursor(x, y, isDrawingRef.current);
        
        // Get thumb tip (landmark 4) - with correct mirroring for drawing canvas
        const thumbTip = landmarks[4];
        const thumbX = (1 - thumbTip.x) * drawingCanvas.width;
        const thumbY = thumbTip.y * drawingCanvas.height;
        
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
            setIsDrawing(true);
          }
          
          // If already drawing, continue drawing
          if (isDrawingRef.current) {
            drawOnCanvas(x, y);
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

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (drawingStateTimeoutRef.current) {
        clearTimeout(drawingStateTimeoutRef.current);
      }
    };
  }, []);

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

  return (
    <div className="App">
      <div className="header">
        <h1>Hand Gesture Whiteboard</h1>
        <div style={{ fontSize: '1.2rem', color: '#ffffff', fontWeight: '600' }}>
          Draw with your fingers!
        </div>
      </div>
      
      <div className="menu">
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
              <span className="color-preview" style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                backgroundColor: brushColor, 
                border: '1px solid #ffffff', 
                marginLeft: '5px',
                verticalAlign: 'middle'
              }}></span>
              <span style={{ marginLeft: '5px', fontSize: '0.8rem' }}>{brushColor}</span>
            </label>
          </div>
          
          <div className="control-group">
            <label>
              Preset Colors
              <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
                {['#ffffff', '#cccccc', '#999999', '#666666', '#333333', '#000000'].map((color) => (
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
                ))}
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
          
          <div className="control-group">
            <label>
              <input 
                type="checkbox" 
                checked={eraserMode} 
                onChange={(e) => setEraserMode(e.target.checked)} 
              />
              Eraser Mode
            </label>
          </div>
          
          <div className="control-group">
            <button onClick={() => setClearCanvas(true)}>Clear Canvas</button>
          </div>
          
          <div className="control-group">
            <button onClick={saveCanvasAsImage}>Save Canvas</button>
          </div>
          
          <div className="control-group">
            <button onClick={testDraw}>Test Draw</button>
          </div>
        </div>
      </div>
      
      {/* Side-by-side layout with drawing canvas on left and camera on right */}
      <div className="content-container">
        <div className="drawing-section">
          <h2>Drawing Canvas</h2>
          <div style={{ position: 'relative' }}>
            <canvas 
              ref={canvasDrawingRef} 
              width={1000} 
              height={700}
              className="drawing-canvas"
            />
            <canvas 
              ref={cursorCanvasRef} 
              width={1000} 
              height={700}
              className="cursor-canvas"
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            />
          </div>
        </div>
        
        <div className="camera-section">
          <h2>Camera View</h2>
          <Webcam 
            ref={webcamRef} 
            className="webcam-feed"
            videoConstraints={{
              facingMode: 'user',
              width: 250,
              height: 250
            }}
          />
          <canvas 
            ref={canvasRef} 
            className="overlay-canvas"
            width={250}
            height={250}
          />
        </div>
      </div>
      
      <div className="instructions">
        <h2>How to Use</h2>
        <ul>
          <li>Pinch your <strong>thumb and index finger</strong> together to draw</li>
          <li>Make a <strong>fist</strong> to clear the canvas</li>
          <li>Toggle <strong>Eraser Mode</strong> to erase instead of draw</li>
          <li>Adjust brush size, color, and smoothing using the controls above</li>
          <li>The blue cursor shows where your pinch will draw</li>
          <li>The red cursor shows where erasing will happen</li>
        </ul>
      </div>
    </div>
  );
}

export default App;