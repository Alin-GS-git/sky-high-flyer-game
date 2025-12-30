
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameStatus, ObstacleType, Obstacle as IObstacle, Cloud as ICloud } from './types';
import { 
  GAME_WIDTH, 
  GAME_HEIGHT, 
  PLANE_X, 
  PLANE_WIDTH, 
  PLANE_HEIGHT, 
  BASE_OBSTACLE_SPEED, 
  SPEED_INCREMENT,
  BASE_OBSTACLE_SPAWN_RATE, 
  MIN_SPAWN_RATE,
  SPAWN_RATE_DECREMENT,
  CLOUD_SPAWN_RATE,
  COLLISION_PADDING,
  INITIAL_PLANE_Y,
  DEFAULT_VOLUME,
  BOOST_DURATION_FRAMES,
  BOOST_SPEED_MULTIPLIER,
  BOOST_SCORE_BONUS
} from './constants';
import { Plane } from './components/Plane';
import { Obstacle } from './components/Obstacle';
import { Cloud } from './components/Cloud';
import { AudioController } from './components/AudioController';

const App: React.FC = () => {
  const [status, setStatus] = useState<GameStatus>(GameStatus.START);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [planeY, setPlaneY] = useState(INITIAL_PLANE_Y);
  const [tilt, setTilt] = useState(0);
  const [obstacles, setObstacles] = useState<IObstacle[]>([]);
  const [clouds, setClouds] = useState<ICloud[]>([]);
  const [isScoring, setIsScoring] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);

  // Audio State
  const [isMuted, setIsMuted] = useState(false);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_VOLUME);
  
  // Web Audio Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const engineOscRef = useRef<OscillatorNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  // Refs for real-time game loop values
  const stateRef = useRef({
    planeY: INITIAL_PLANE_Y,
    obstacles: [] as IObstacle[],
    clouds: [] as ICloud[],
    score: 0,
    status: GameStatus.START,
    lastObstacleSpawn: 0,
    lastCloudSpawn: 0,
    inputY: INITIAL_PLANE_Y,
    keys: { ArrowUp: false, ArrowDown: false },
    boostTimer: 0
  });

  const requestRef = useRef<number | null>(null);

  // Initialize Web Audio Engine
  const initAudio = () => {
    if (audioCtxRef.current) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = isMuted ? 0 : musicVolume;
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    const engineOsc = ctx.createOscillator();
    const engineGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    engineOsc.type = 'triangle';
    engineOsc.frequency.setValueAtTime(55, ctx.currentTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, ctx.currentTime);

    engineGain.gain.value = 0.4;

    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(masterGain);

    engineOsc.start();
    
    engineOscRef.current = engineOsc;
  };

  const playScoreBeep = (isBoost = false) => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || isMuted) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isBoost ? 'square' : 'sine';
    osc.frequency.setValueAtTime(isBoost ? 1320 : 880, ctx.currentTime);
    if (isBoost) {
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
    }

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isBoost ? 0.3 : 0.15));

    osc.connect(gain);
    gain.connect(master);

    osc.start();
    osc.stop(ctx.currentTime + (isBoost ? 0.4 : 0.2));
  };

  const playCrashSound = () => {
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master || isMuted) return;

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseBuffer.length; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    noise.start();
  };

  const playSound = (type: 'score' | 'crash' | 'boost') => {
    if (type === 'score') {
      playScoreBeep(false);
      setIsScoring(true);
      setTimeout(() => setIsScoring(false), 100);
    } else if (type === 'boost') {
      playScoreBeep(true);
    } else {
      playCrashSound();
    }
  };

  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      const targetGain = isMuted ? 0 : musicVolume;
      masterGainRef.current.gain.setTargetAtTime(targetGain, audioCtxRef.current.currentTime, 0.05);
    }
  }, [musicVolume, isMuted]);

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  const handleVolumeChange = (vol: number) => {
    setMusicVolume(vol);
    if (vol > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') stateRef.current.keys.ArrowUp = true;
      if (e.key === 'ArrowDown') stateRef.current.keys.ArrowDown = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') stateRef.current.keys.ArrowUp = false;
      if (e.key === 'ArrowDown') stateRef.current.keys.ArrowDown = false;
    };
    const handleMouseMove = (e: MouseEvent) => {
      const container = document.getElementById('game-container');
      if (container) {
        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top - (PLANE_HEIGHT / 2);
        stateRef.current.inputY = Math.max(0, Math.min(GAME_HEIGHT - PLANE_HEIGHT, y));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const spawnObstacle = useCallback(() => {
    const rand = Math.random();
    let type: ObstacleType;
    let width = 40;
    let height = 40;
    let initialY = 0;
    let verticalSpeed = 0;
    let phase = Math.random() * Math.PI * 2;

    // Weighted selection: Cloud 30%, Balloon 20%, Satellite 15%, Bomb 15%, Bird 10%, Boost Star 10%
    if (rand < 0.30) {
      type = ObstacleType.STATIC_CLOUD;
      width = 120;
      height = 70;
      initialY = Math.random() * (GAME_HEIGHT - height);
    } else if (rand < 0.50) {
      type = ObstacleType.OSCILLATING_BALLOON;
      width = 40;
      height = 60;
      initialY = Math.random() * (GAME_HEIGHT - 120) + 30;
    } else if (rand < 0.65) {
      type = ObstacleType.FALLING_SATELLITE;
      width = 75;
      height = 75;
      initialY = -75;
      verticalSpeed = 1.5;
    } else if (rand < 0.80) {
      type = ObstacleType.BOMB;
      width = 50;
      height = 50;
      initialY = Math.random() * (GAME_HEIGHT - height);
    } else if (rand < 0.90) {
      type = ObstacleType.BOOST_STAR;
      width = 40;
      height = 40;
      initialY = Math.random() * (GAME_HEIGHT - height);
    } else {
      type = ObstacleType.FAST_BIRD;
      width = 30;
      height = 30;
      initialY = Math.random() * (GAME_HEIGHT - height);
    }
    
    const newObstacle: IObstacle = {
      id: Math.random().toString(36).substr(2, 9),
      x: GAME_WIDTH,
      y: initialY,
      width,
      height,
      type,
      passed: false,
      initialY,
      phase,
      verticalSpeed,
      spawnTime: performance.now()
    };
    stateRef.current.obstacles.push(newObstacle);
  }, []);

  const spawnCloud = useCallback(() => {
    const newCloud: ICloud = {
      id: Math.random().toString(36).substr(2, 9),
      x: GAME_WIDTH,
      y: Math.random() * (GAME_HEIGHT - 60),
      scale: 0.5 + Math.random(),
      speed: 1 + Math.random() * 2
    };
    stateRef.current.clouds.push(newCloud);
  }, []);

  const gameLoop = useCallback((time: number) => {
    if (stateRef.current.status !== GameStatus.PLAYING) return;

    const { keys, inputY, score: currentScore, boostTimer } = stateRef.current;
    
    // Decrement boost timer
    if (stateRef.current.boostTimer > 0) {
      stateRef.current.boostTimer--;
      if (stateRef.current.boostTimer === 0) setIsBoosting(false);
    }

    const isCurrentlyBoosting = stateRef.current.boostTimer > 0;
    const boostMult = isCurrentlyBoosting ? BOOST_SPEED_MULTIPLIER : 1.0;
    const baseSpeed = (BASE_OBSTACLE_SPEED + (currentScore * SPEED_INCREMENT)) * boostMult;
    const currentSpawnInterval = Math.max(MIN_SPAWN_RATE, (BASE_OBSTACLE_SPAWN_RATE - (currentScore * SPAWN_RATE_DECREMENT)) / boostMult);

    let targetY = stateRef.current.planeY;

    if (keys.ArrowUp) {
      targetY -= 7;
    } else if (keys.ArrowDown) {
      targetY += 7;
    } else {
      targetY += (inputY - targetY) * 0.15;
    }

    targetY = Math.max(0, Math.min(GAME_HEIGHT - PLANE_HEIGHT, targetY));
    
    const dy = targetY - stateRef.current.planeY;
    const newTilt = Math.max(-25, Math.min(25, dy * 3.5));
    
    if (engineOscRef.current && audioCtxRef.current) {
        const freqBase = isCurrentlyBoosting ? 110 : 55;
        const freqShift = freqBase + (newTilt * 0.5);
        engineOscRef.current.frequency.setTargetAtTime(freqShift, audioCtxRef.current.currentTime, 0.1);
    }

    stateRef.current.planeY = targetY;
    setPlaneY(targetY);
    setTilt(newTilt);

    if (time - stateRef.current.lastObstacleSpawn > currentSpawnInterval) {
      spawnObstacle();
      stateRef.current.lastObstacleSpawn = time;
    }
    if (time - stateRef.current.lastCloudSpawn > (CLOUD_SPAWN_RATE / boostMult)) {
      spawnCloud();
      stateRef.current.lastCloudSpawn = time;
    }

    stateRef.current.obstacles = stateRef.current.obstacles
      .map(obs => {
        let speedMult = 1.0;
        let nextX = obs.x;
        let nextY = obs.y;

        if (obs.type === ObstacleType.FAST_BIRD) speedMult = 2.0;
        if (obs.type === ObstacleType.STATIC_CLOUD) speedMult = 0.7;

        nextX -= baseSpeed * speedMult;

        if (obs.type === ObstacleType.BOMB) {
          nextX += (Math.random() - 0.5) * 2;
        }

        if (obs.type === ObstacleType.OSCILLATING_BALLOON) {
          const elapsed = (time - obs.spawnTime) / 1000;
          nextY = (obs.initialY || 0) + Math.sin(elapsed * 2 + (obs.phase || 0)) * 50;
        } else if (obs.type === ObstacleType.FALLING_SATELLITE) {
          nextY += (obs.verticalSpeed || 1.5);
        }

        return { ...obs, x: nextX, y: nextY };
      })
      .filter(obs => obs.x > -150 && obs.y < GAME_HEIGHT + 150);

    stateRef.current.clouds = stateRef.current.clouds
      .map(cloud => ({ ...cloud, x: cloud.x - (cloud.speed * boostMult) }))
      .filter(cloud => cloud.x > -200);

    const planeRect = {
      left: PLANE_X + COLLISION_PADDING,
      right: PLANE_X + PLANE_WIDTH - COLLISION_PADDING,
      top: stateRef.current.planeY + COLLISION_PADDING,
      bottom: stateRef.current.planeY + PLANE_HEIGHT - COLLISION_PADDING
    };

    // Use filtering to handle collection of stars
    stateRef.current.obstacles = stateRef.current.obstacles.filter(obs => {
      const obsRect = {
        left: obs.x + 5,
        right: obs.x + obs.width - 5,
        top: obs.y + 5,
        bottom: obs.y + obs.height - 5
      };

      const isColliding = (
        planeRect.left < obsRect.right &&
        planeRect.right > obsRect.left &&
        planeRect.top < obsRect.bottom &&
        planeRect.bottom > obsRect.top
      );

      if (isColliding) {
        if (obs.type === ObstacleType.BOOST_STAR) {
          // Collected Boost Star
          stateRef.current.score += BOOST_SCORE_BONUS;
          stateRef.current.boostTimer = BOOST_DURATION_FRAMES;
          setScore(stateRef.current.score);
          setIsBoosting(true);
          playSound('boost');
          return false; // Remove star from game
        } else if (!isCurrentlyBoosting) {
          // Regular obstacle hit while NOT boosting
          endGame();
        }
      }

      if (!obs.passed && obs.x < PLANE_X) {
        obs.passed = true;
        stateRef.current.score += 1;
        setScore(stateRef.current.score);
        playSound('score');
      }

      return true;
    });

    setObstacles([...stateRef.current.obstacles]);
    setClouds([...stateRef.current.clouds]);

    requestRef.current = requestAnimationFrame(gameLoop);
  }, [spawnObstacle, spawnCloud]);

  const startGame = () => {
    initAudio();
    if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume();
    }

    stateRef.current = {
      ...stateRef.current,
      planeY: INITIAL_PLANE_Y,
      obstacles: [],
      clouds: [],
      score: 0,
      status: GameStatus.PLAYING,
      lastObstacleSpawn: performance.now(),
      lastCloudSpawn: performance.now(),
      inputY: INITIAL_PLANE_Y,
      boostTimer: 0
    };
    setScore(0);
    setObstacles([]);
    setClouds([]);
    setPlaneY(INITIAL_PLANE_Y);
    setTilt(0);
    setIsBoosting(false);
    setStatus(GameStatus.PLAYING);
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const endGame = () => {
    playSound('crash');
    stateRef.current.status = GameStatus.GAME_OVER;
    setStatus(GameStatus.GAME_OVER);
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    
    setHighScore(prev => {
      const newScore = stateRef.current.score;
      return newScore > prev ? newScore : prev;
    });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="flex flex-col items-center w-full max-w-[800px]">
        <div className="w-full flex justify-between items-end mb-4">
          <div className="flex flex-col">
            <h1 className="text-4xl font-black text-white drop-shadow-md tracking-tighter uppercase italic">
              Sky High Flyer
            </h1>
            <div className="flex gap-4 text-white font-bold text-sm mt-1">
              <div className={`bg-white/10 px-4 py-1 rounded-full backdrop-blur-sm border border-white/20 transition-all duration-100 ${isScoring ? 'scale-110 bg-yellow-500/30' : ''} ${isBoosting ? 'border-yellow-400 bg-yellow-400/20' : ''}`}>
                SCORE: <span className={isBoosting ? 'text-yellow-200' : 'text-yellow-400'}>{score}</span>
              </div>
              <div className="bg-white/10 px-4 py-1 rounded-full backdrop-blur-sm border border-white/20">
                BEST: <span className="text-yellow-400">{highScore}</span>
              </div>
            </div>
          </div>
          
          <AudioController 
            isMuted={isMuted}
            volume={musicVolume}
            onToggleMute={toggleMute}
            onVolumeChange={handleVolumeChange}
          />
        </div>

        <div 
          id="game-container"
          className={`relative overflow-hidden sky-bg rounded-2xl shadow-2xl border-4 transition-colors duration-300 ${status === GameStatus.GAME_OVER ? 'border-red-500' : isBoosting ? 'border-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.5)]' : 'border-white/30'}`}
          style={{ width: GAME_WIDTH, height: GAME_HEIGHT, cursor: status === GameStatus.PLAYING ? 'none' : 'default' }}
        >
          {clouds.map(cloud => (
            <Cloud key={cloud.id} cloud={cloud} />
          ))}

          <Plane y={planeY} tilt={tilt} isBoosting={isBoosting} />

          {obstacles.map(obs => (
            <Obstacle key={obs.id} obstacle={obs} />
          ))}

          {isBoosting && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
              <div className="bg-yellow-400 text-black px-4 py-1 rounded-full font-black text-xs uppercase animate-bounce shadow-lg">
                BOOST ACTIVE! Invincible Speed!
              </div>
            </div>
          )}

          {status === GameStatus.PLAYING && !isBoosting && score > 0 && score % 10 === 0 && (
            <div className="absolute top-4 right-4 bg-black/30 backdrop-blur-sm text-xs text-white/80 px-2 py-1 rounded animate-pulse">
              DANGER INCREASING!
            </div>
          )}

          {status === GameStatus.START && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center z-50 text-white text-center p-8">
              <div className="bg-white text-red-500 p-4 rounded-full mb-6 animate-bounce">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
              </div>
              <h2 className="text-5xl font-black mb-4 tracking-tight">READY FOR TAKEOFF?</h2>
              <p className="mb-8 text-xl text-blue-100 max-w-md">
                Dodge obstacles and grab <span className="text-yellow-300 font-bold">Stars</span> for a massive boost and bonus points!
              </p>
              <button 
                onClick={startGame}
                className="bg-yellow-400 hover:bg-yellow-300 text-black font-black py-4 px-12 rounded-full text-2xl shadow-xl transition-all hover:scale-105 active:scale-95 border-b-4 border-yellow-600"
              >
                START GAME
              </button>
            </div>
          )}

          {status === GameStatus.GAME_OVER && (
            <div className="absolute inset-0 bg-red-600/60 backdrop-blur-md flex flex-col items-center justify-center z-50 text-white text-center animate-in fade-in duration-300">
              <h2 className="text-7xl font-black mb-2 tracking-tighter italic">CRASHED!</h2>
              <div className="bg-white/20 backdrop-blur-md rounded-2xl p-6 mb-8 border border-white/30">
                <p className="text-2xl mb-1 opacity-80 uppercase tracking-widest font-bold">Final Score</p>
                <p className="text-8xl font-black text-yellow-300 drop-shadow-lg">{score}</p>
              </div>
              <button 
                onClick={startGame}
                className="bg-white hover:bg-blue-50 text-red-600 font-black py-4 px-12 rounded-full text-2xl shadow-2xl transition-all hover:scale-105 active:scale-95 uppercase tracking-tight"
              >
                TRY AGAIN
              </button>
            </div>
          )}
        </div>

        <div className="mt-8 flex gap-4">
           <div className="flex items-center gap-2 text-white/60 text-sm bg-white/5 px-4 py-2 rounded-lg border border-white/10">
              <div className="bg-white/20 p-1 rounded">↑↓</div>
              <span>Arrow keys to steer</span>
           </div>
           <div className="flex items-center gap-2 text-white/60 text-sm bg-white/5 px-4 py-2 rounded-lg border border-white/10">
              <div className="bg-white/20 p-1 rounded">🖱️</div>
              <span>Mouse moves plane</span>
           </div>
        </div>
      </div>
    </div>
  );
};

export default App;
