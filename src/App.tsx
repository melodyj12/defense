/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Target, Trophy, RotateCcw, Languages, Volume2, VolumeX, Info, X } from 'lucide-react';
import { GameStatus, Point, Rocket, Missile, Explosion, Battery, City, Language, PowerUp } from './types';
import { translations } from './constants';

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const EXPLOSION_MAX_RADIUS = 35;
const EXPLOSION_SPEED = 1.5;
const MISSILE_SPEED = 7;
const ROCKET_SPEED_MIN = 0.4;
const ROCKET_SPEED_MAX = 0.8;

export default function App() {
  const [status, setStatus] = useState<GameStatus>(GameStatus.START);
  const [score, setScore] = useState(0);
  const [lang, setLang] = useState<Language>('zh');
  const [isMuted, setIsMuted] = useState(false);
  const [isSugarActive, setIsSugarActive] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const requestRef = useRef<number>(null);

  const playSfx = useCallback((type: 'score' | 'loss' | 'gameOver' | 'powerup') => {
    if (isMuted || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.connect(env);
    env.connect(ctx.destination);

    if (type === 'score') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
      env.gain.setValueAtTime(0.1, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'loss') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.linearRampToValueAtTime(55, now + 0.2);
      env.gain.setValueAtTime(0.1, now);
      env.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'gameOver') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.5);
      osc.frequency.linearRampToValueAtTime(55, now + 1.0);
      env.gain.setValueAtTime(0.2, now);
      env.gain.linearRampToValueAtTime(0, now + 1.0);
      osc.start(now);
      osc.stop(now + 1.0);
    } else if (type === 'powerup') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.1);
      osc.frequency.linearRampToValueAtTime(1320, now + 0.2);
      env.gain.setValueAtTime(0.05, now);
      env.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  }, [isMuted]);
  
  // Game State Refs (to avoid re-renders on every frame)
  const rocketsRef = useRef<Rocket[]>([]);
  const missilesRef = useRef<Missile[]>([]);
  const explosionsRef = useRef<Explosion[]>([]);
  const powerUpsRef = useRef<PowerUp[]>([]);
  const batteriesRef = useRef<Battery[]>([
    { x: 100, y: CANVAS_HEIGHT - 40, missiles: 50, maxMissiles: 50, active: true },
    { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40, missiles: 100, maxMissiles: 100, active: true },
    { x: CANVAS_WIDTH - 100, y: CANVAS_HEIGHT - 40, missiles: 50, maxMissiles: 50, active: true },
  ]);
  const citiesRef = useRef<City[]>([
    { x: 150, active: true },
    { x: 250, active: true },
    { x: 350, active: true },
    { x: 450, active: true },
    { x: 550, active: true },
    { x: 650, active: true },
  ]);
  const lastSpawnTime = useRef<number>(0);
  const starsRef = useRef<{x: number, y: number, size: number, opacity: number}[]>([]);
  const t = translations[lang];

  useEffect(() => {
    if (status === GameStatus.PLAYING && !isMuted) {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        gainNodeRef.current = audioCtxRef.current.createGain();
        gainNodeRef.current.connect(audioCtxRef.current.destination);
      }
      
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }

      const ctx = audioCtxRef.current;
      const gain = gainNodeRef.current!;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);

      // Create distortion curve for cyberpunk grit
      const makeDistortionCurve = (amount: number) => {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
          const x = (i * 2) / n_samples - 1;
          curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        return curve;
      };

      const distortion = ctx.createWaveShaper();
      distortion.curve = makeDistortionCurve(400);
      distortion.oversample = '4x';
      distortion.connect(gain);

      let step = 0;
      const interval = setInterval(() => {
        if (status !== GameStatus.PLAYING || isMuted) return;
        
        const now = ctx.currentTime;
        
        // Cyberpunk Bass: Gritty Square Wave
        const bassOsc = ctx.createOscillator();
        const bassEnv = ctx.createGain();
        const bassFilter = ctx.createBiquadFilter();
        
        // Pattern: C1, C1, Eb1, F1, C1, C1, Bb0, G0
        const bassNotes = [32.70, 32.70, 38.89, 43.65, 32.70, 32.70, 29.14, 24.50];
        bassOsc.frequency.setValueAtTime(bassNotes[step % 8], now);
        bassOsc.type = 'square';
        
        bassFilter.type = 'lowpass';
        bassFilter.frequency.setValueAtTime(600, now);
        bassFilter.Q.setValueAtTime(10, now);
        bassFilter.frequency.exponentialRampToValueAtTime(100, now + 0.2);
        
        bassOsc.connect(bassFilter);
        bassFilter.connect(bassEnv);
        bassEnv.connect(distortion);
        
        bassEnv.gain.setValueAtTime(0, now);
        bassEnv.gain.linearRampToValueAtTime(0.4, now + 0.02);
        bassEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        
        bassOsc.start(now);
        bassOsc.stop(now + 0.25);
        
        // Mechanical Percussion: Metallic Snare/Click
        if (step % 2 === 1) {
          const noise = ctx.createBufferSource();
          const bufferSize = ctx.sampleRate * 0.1;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
          }
          noise.buffer = buffer;
          
          const noiseFilter = ctx.createBiquadFilter();
          noiseFilter.type = 'bandpass';
          noiseFilter.frequency.setValueAtTime(step % 4 === 3 ? 1200 : 2500, now);
          
          const noiseEnv = ctx.createGain();
          noiseEnv.gain.setValueAtTime(0.3, now);
          noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
          
          noise.connect(noiseFilter);
          noiseFilter.connect(noiseEnv);
          noiseEnv.connect(gain);
          
          noise.start(now);
          noise.stop(now + 0.1);
        }

        // High-tech "Glitch" Arp
        if (step % 4 === 0) {
          const arp = ctx.createOscillator();
          const arpEnv = ctx.createGain();
          arp.type = 'triangle';
          arp.frequency.setValueAtTime(880, now);
          arp.frequency.exponentialRampToValueAtTime(1760, now + 0.1);
          
          arp.connect(arpEnv);
          arpEnv.connect(gain);
          
          arpEnv.gain.setValueAtTime(0, now);
          arpEnv.gain.linearRampToValueAtTime(0.1, now + 0.01);
          arpEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          
          arp.start(now);
          arp.stop(now + 0.1);
        }

        step++;
      }, 200); // Faster tempo for driving feel

      return () => clearInterval(interval);
    }
  }, [status, isMuted]);

  useEffect(() => {
    const stars = [];
    for (let i = 0; i < 200; i++) {
      stars.push({
        x: Math.random() * CANVAS_WIDTH,
        y: Math.random() * CANVAS_HEIGHT,
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random()
      });
    }
    starsRef.current = stars;
  }, []);

  const initGame = useCallback(() => {
    setScore(0);
    setIsSugarActive(false);
    rocketsRef.current = [];
    missilesRef.current = [];
    explosionsRef.current = [];
    powerUpsRef.current = [];
    batteriesRef.current = [
      { x: 100, y: CANVAS_HEIGHT - 40, missiles: 50, maxMissiles: 50, active: true },
      { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT - 40, missiles: 100, maxMissiles: 100, active: true },
      { x: CANVAS_WIDTH - 100, y: CANVAS_HEIGHT - 40, missiles: 50, maxMissiles: 50, active: true },
    ];
    citiesRef.current = [
      { x: 150, active: true },
      { x: 250, active: true },
      { x: 350, active: true },
      { x: 450, active: true },
      { x: 550, active: true },
      { x: 650, active: true },
    ];
    setStatus(GameStatus.PLAYING);
  }, []);

  const spawnRocket = useCallback(() => {
    const startX = Math.random() * CANVAS_WIDTH;
    const targets = [...citiesRef.current.filter(c => c.active), ...batteriesRef.current.filter(b => b.active)];
    if (targets.length === 0) return;
    
    const target = targets[Math.floor(Math.random() * targets.length)];
    const targetX = 'x' in target ? target.x : (target as any).x;
    
    const id = Math.random().toString(36).substring(7);
    rocketsRef.current.push({
      id,
      start: { x: startX, y: 0 },
      current: { x: startX, y: 0 },
      target: { x: targetX, y: CANVAS_HEIGHT - 20 },
      speed: ROCKET_SPEED_MIN + Math.random() * (ROCKET_SPEED_MAX - ROCKET_SPEED_MIN),
      color: '#ff4444'
    });
  }, []);

  const spawnPowerUp = useCallback(() => {
    const id = Math.random().toString(36).substring(7);
    const type = Math.random() > 0.5 ? 'AMMO' : 'SUGAR';
    powerUpsRef.current.push({
      id,
      x: 50 + Math.random() * (CANVAS_WIDTH - 100),
      y: 100 + Math.random() * (CANVAS_HEIGHT - 300),
      type,
      createdAt: Date.now(),
      duration: 5000 // 5 seconds
    });
  }, []);

  const handleFire = (e: React.MouseEvent | React.TouchEvent) => {
    if (status !== GameStatus.PLAYING) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // Don't fire too low
    if (y > CANVAS_HEIGHT - 80) return;

    // Find best battery
    let bestBatteryIndex = -1;
    let minDist = Infinity;

    batteriesRef.current.forEach((b, i) => {
      const cost = i === 0 ? 10 : 1;
      if (b.active && b.missiles >= cost) {
        const dist = Math.abs(b.x - x);
        if (dist < minDist) {
          minDist = dist;
          bestBatteryIndex = i;
        }
      }
    });

    if (bestBatteryIndex !== -1) {
      const battery = batteriesRef.current[bestBatteryIndex];
      
      if (bestBatteryIndex === 0) {
        // Left Battery: Nuke (consumes 10)
        battery.missiles -= 10;
        missilesRef.current.push({
          id: Math.random().toString(36).substring(7),
          start: { x: battery.x, y: battery.y },
          current: { x: battery.x, y: battery.y },
          target: { x, y },
          speed: MISSILE_SPEED * 0.7,
          batteryIndex: bestBatteryIndex
        });
      } else if (bestBatteryIndex === 1) {
        // Middle Battery: Dual Tracking (Sure to hit)
        const activeRockets = [...rocketsRef.current];
        activeRockets.sort((a, b) => {
          const distA = Math.sqrt(Math.pow(a.current.x - x, 2) + Math.pow(a.current.y - y, 2));
          const distB = Math.sqrt(Math.pow(b.current.x - x, 2) + Math.pow(b.current.y - y, 2));
          return distA - distB;
        });

        const targets = activeRockets.slice(0, 2);
        const count = Math.max(1, targets.length);
        battery.missiles -= count;

        if (targets.length > 0) {
          targets.forEach(targetRocket => {
            missilesRef.current.push({
              id: Math.random().toString(36).substring(7),
              start: { x: battery.x, y: battery.y },
              current: { x: battery.x, y: battery.y },
              target: { x: targetRocket.current.x, y: targetRocket.current.y },
              speed: MISSILE_SPEED * 1.5, // Faster for "sure to hit" feel
              batteryIndex: bestBatteryIndex,
              targetRocketId: targetRocket.id
            });
          });
        } else {
          missilesRef.current.push({
            id: Math.random().toString(36).substring(7),
            start: { x: battery.x, y: battery.y },
            current: { x: battery.x, y: battery.y },
            target: { x, y },
            speed: MISSILE_SPEED,
            batteryIndex: bestBatteryIndex
          });
        }
      } else if (bestBatteryIndex === 2) {
        // Right Battery: Double Range
        battery.missiles -= 1;
        missilesRef.current.push({
          id: Math.random().toString(36).substring(7),
          start: { x: battery.x, y: battery.y },
          current: { x: battery.x, y: battery.y },
          target: { x, y },
          speed: MISSILE_SPEED,
          batteryIndex: bestBatteryIndex
        });
      }
    }
  };

  const update = useCallback((time: number) => {
    if (status !== GameStatus.PLAYING) return;

    // Spawn rockets
    const spawnDelay = Math.max(200, 1500 - Math.min(score, 800));
    if (time - lastSpawnTime.current > spawnDelay) {
      spawnRocket();
      lastSpawnTime.current = time;
      
      // Randomly spawn power-up
      if (Math.random() < 0.1) {
        spawnPowerUp();
      }
    }

    // Win Condition
    // Removed level-based win condition

    // Update Rockets
    rocketsRef.current.forEach((rocket, index) => {
      const dx = rocket.target.x - rocket.start.x;
      const dy = rocket.target.y - rocket.start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vx = (dx / dist) * rocket.speed;
      const vy = (dy / dist) * rocket.speed;

      rocket.current.x += vx * (isSugarActive ? 0.4 : 1);
      rocket.current.y += vy * (isSugarActive ? 0.4 : 1);

      // Check if hit ground
      if (rocket.current.y >= rocket.target.y) {
        // Impact!
        playSfx('loss');
        explosionsRef.current.push({
          id: 'impact-' + rocket.id,
          x: rocket.current.x,
          y: rocket.current.y,
          radius: 2,
          maxRadius: 20,
          growing: true
        });

        // Check damage to cities/batteries
        citiesRef.current.forEach(city => {
          if (city.active && Math.abs(city.x - rocket.current.x) < 30) {
            city.active = false;
            setScore(prev => Math.max(0, prev - 10));
          }
        });
        batteriesRef.current.forEach(battery => {
          if (battery.active && Math.abs(battery.x - rocket.current.x) < 30) {
            battery.active = false;
            setScore(prev => Math.max(0, prev - 30));
          }
        });

        rocketsRef.current.splice(index, 1);
      }
    });

    // Update Missiles
    missilesRef.current.forEach((missile, index) => {
      // If tracking, update target to rocket's current position
      if (missile.targetRocketId) {
        const targetRocket = rocketsRef.current.find(r => r.id === missile.targetRocketId);
        if (targetRocket) {
          missile.target = { ...targetRocket.current };
        } else {
          // Rocket destroyed, missile explodes at last known position
          missile.targetRocketId = undefined;
        }
      }

      const dx = missile.target.x - missile.start.x;
      const dy = missile.target.y - missile.start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vx = (dx / dist) * missile.speed;
      const vy = (dy / dist) * missile.speed;

      missile.current.x += vx;
      missile.current.y += vy;

      const distToTarget = Math.sqrt(
        Math.pow(missile.target.x - missile.current.x, 2) + 
        Math.pow(missile.target.y - missile.current.y, 2)
      );

      if (distToTarget < missile.speed) {
        const isNuke = missile.batteryIndex === 0;
        const isWide = missile.batteryIndex === 2;
        explosionsRef.current.push({
          id: 'exp-' + missile.id,
          x: missile.target.x,
          y: missile.target.y,
          radius: 2,
          maxRadius: isNuke ? 150 : (isWide ? 70 : EXPLOSION_MAX_RADIUS),
          growing: true
        });
        missilesRef.current.splice(index, 1);
      }
    });

    // Update PowerUps
    const now = Date.now();
    powerUpsRef.current.forEach((pu, index) => {
      if (now - pu.createdAt > pu.duration) {
        powerUpsRef.current.splice(index, 1);
      }
    });

    // Update Explosions
    explosionsRef.current.forEach((exp, index) => {
      if (exp.growing) {
        exp.radius += EXPLOSION_SPEED;
        if (exp.radius >= exp.maxRadius) exp.growing = false;
      } else {
        exp.radius -= EXPLOSION_SPEED * 0.5;
        if (exp.radius <= 0) {
          explosionsRef.current.splice(index, 1);
        }
      }

      // Check collisions with rockets
      rocketsRef.current.forEach((rocket, rIndex) => {
        const dist = Math.sqrt(
          Math.pow(exp.x - rocket.current.x, 2) + 
          Math.pow(exp.y - rocket.current.y, 2)
        );
        if (dist < exp.radius) {
          rocketsRef.current.splice(rIndex, 1);
          setScore(prev => prev + 20);
          playSfx('score');
        }
      });

      // Check collisions with power-ups
      powerUpsRef.current.forEach((pu, puIndex) => {
        const dist = Math.sqrt(
          Math.pow(exp.x - pu.x, 2) + 
          Math.pow(exp.y - pu.y, 2)
        );
        if (dist < exp.radius) {
          playSfx('powerup');
          if (pu.type === 'AMMO') {
            // Refill all active batteries
            batteriesRef.current.forEach(b => {
              if (b.active) b.missiles = b.maxMissiles;
            });
          } else if (pu.type === 'SUGAR') {
            setIsSugarActive(true);
            setTimeout(() => setIsSugarActive(false), 5000);
          }
          powerUpsRef.current.splice(puIndex, 1);
        }
      });
    });

    // Check battery ammo
    batteriesRef.current.forEach((b, i) => {
      const cost = i === 0 ? 10 : 1;
      if (b.active && b.missiles < cost) {
        b.active = false;
      }
    });

    // Check Lose Condition
    if (batteriesRef.current.every(b => !b.active)) {
      setStatus(GameStatus.LOST);
      playSfx('gameOver');
    }
  }, [status, score, spawnRocket, spawnPowerUp, isSugarActive, playSfx]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Background
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Nebula effect
    const nebula1 = ctx.createRadialGradient(CANVAS_WIDTH * 0.3, CANVAS_HEIGHT * 0.3, 0, CANVAS_WIDTH * 0.3, CANVAS_HEIGHT * 0.3, 300);
    nebula1.addColorStop(0, 'rgba(40, 20, 80, 0.2)');
    nebula1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = nebula1;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const nebula2 = ctx.createRadialGradient(CANVAS_WIDTH * 0.7, CANVAS_HEIGHT * 0.6, 0, CANVAS_WIDTH * 0.7, CANVAS_HEIGHT * 0.6, 400);
    nebula2.addColorStop(0, 'rgba(20, 40, 60, 0.15)');
    nebula2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = nebula2;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Stars
    starsRef.current.forEach(star => {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * (0.5 + Math.sin(Date.now() * 0.001 + star.x) * 0.5)})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // Ground
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, CANVAS_HEIGHT - 20, CANVAS_WIDTH, 20);

    // Draw Cities
    citiesRef.current.forEach(city => {
      if (city.active) {
        ctx.fillStyle = '#4ecca3';
        ctx.fillRect(city.x - 20, CANVAS_HEIGHT - 40, 40, 20);
        ctx.fillRect(city.x - 10, CANVAS_HEIGHT - 50, 20, 10);
      }
    });

    // Draw Batteries
    batteriesRef.current.forEach((b, i) => {
      if (b.active) {
        if (i === 0) ctx.fillStyle = '#e74c3c'; // Red for Nuke
        else if (i === 1) ctx.fillStyle = '#f1c40f'; // Yellow for Tracking
        else ctx.fillStyle = '#3498db'; // Blue for Wide
        
        ctx.beginPath();
        ctx.moveTo(b.x - 30, b.y + 20);
        ctx.lineTo(b.x + 30, b.y + 20);
        ctx.lineTo(b.x + 15, b.y);
        ctx.lineTo(b.x - 15, b.y);
        ctx.closePath();
        ctx.fill();
        
        // Battery Type Icon/Text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        let label = 'WIDE';
        if (i === 0) label = 'NUKE';
        else if (i === 1) label = 'TRACK';
        ctx.fillText(label, b.x, b.y - 5);

        // Missile Count text
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(b.missiles.toString(), b.x, b.y + 15);
      }
    });

    // Update Rockets
    rocketsRef.current.forEach(rocket => {
      ctx.strokeStyle = rocket.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rocket.start.x, rocket.start.y);
      ctx.lineTo(rocket.current.x, rocket.current.y);
      ctx.stroke();

      // Rocket head
      ctx.fillStyle = '#fff';
      ctx.fillRect(rocket.current.x - 2, rocket.current.y - 2, 4, 4);
    });

    // Draw Missiles
    missilesRef.current.forEach(missile => {
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(missile.start.x, missile.start.y);
      ctx.lineTo(missile.current.x, missile.current.y);
      ctx.stroke();

      // Missile Head (Bullet)
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(missile.current.x, missile.current.y, 2, 0, Math.PI * 2);
      ctx.fill();

      // Target Marker
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      const size = 6;
      
      ctx.beginPath();
      ctx.moveTo(missile.target.x - size, missile.target.y - size);
      ctx.lineTo(missile.target.x + size, missile.target.y + size);
      ctx.moveTo(missile.target.x + size, missile.target.y - size);
      ctx.lineTo(missile.target.x - size, missile.target.y + size);
      ctx.stroke();
    });

    // Draw PowerUps
    powerUpsRef.current.forEach(pu => {
      const age = Date.now() - pu.createdAt;
      const opacity = Math.max(0, 1 - age / pu.duration);
      
      ctx.save();
      ctx.globalAlpha = opacity;
      
      // Draw Bullet Icon
      ctx.fillStyle = pu.type === 'AMMO' ? '#f1c40f' : '#ff9ff3';
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, 8, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pu.type === 'AMMO' ? 'B' : 'S', pu.x, pu.y);
      
      // Glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = pu.type === 'AMMO' ? '#f1c40f' : '#ff9ff3';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.restore();
    });

    // Draw Explosions
    explosionsRef.current.forEach(exp => {
      const gradient = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, exp.radius);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      gradient.addColorStop(0.4, 'rgba(255, 165, 0, 0.6)');
      gradient.addColorStop(1, 'rgba(255, 69, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
      ctx.fill();
    });

  }, [status]);

  const loop = useCallback((time: number) => {
    update(time);
    draw();
    requestRef.current = requestAnimationFrame(loop);
  }, [update, draw]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [loop]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-emerald-500/30 flex flex-col items-center justify-center p-4">
      {/* Header / HUD */}
      <div className="w-full max-w-[800px] flex justify-between items-center mb-4 px-2">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tighter text-emerald-400 flex items-center gap-2">
            <Shield className="w-6 h-6" />
            {t.title}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-white/5 px-3 py-1 rounded-full border border-white/10 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <span className="font-mono text-sm">{t.score}: {score}</span>
          </div>
          <button 
            onClick={() => setIsMuted(m => !m)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2 text-sm opacity-70 hover:opacity-100"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button 
            onClick={() => setShowDescription(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2 text-sm opacity-70 hover:opacity-100"
            title={t.descriptionTitle}
          >
            <Info className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}
            className="p-2 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2 text-sm opacity-70 hover:opacity-100"
          >
            <Languages className="w-4 h-4" />
            {lang === 'en' ? '中文' : 'EN'}
          </button>
        </div>
      </div>

      {/* Game Area */}
      <div className="relative w-full max-w-[800px] aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onMouseDown={handleFire}
          onTouchStart={handleFire}
          className="w-full h-full cursor-crosshair touch-none"
        />

        {/* Overlays */}
        <AnimatePresence>
          {showDescription && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6"
            >
              <div className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-2xl relative">
                <button 
                  onClick={() => setShowDescription(false)}
                  className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
                
                <h3 className="text-2xl font-bold text-emerald-400 mb-4 flex items-center gap-2">
                  <Info className="w-6 h-6" />
                  {t.descriptionTitle}
                </h3>
                
                <p className="text-zinc-300 leading-relaxed mb-6">
                  {t.description}
                </p>
                
                <button
                  onClick={() => setShowDescription(false)}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-black font-bold rounded-xl transition-all active:scale-95"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          )}

          {status === GameStatus.START && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-8 text-center"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <h2 className="text-4xl md:text-6xl font-black mb-4 tracking-tighter uppercase italic text-emerald-400">
                  {t.title}
                </h2>
                <p className="text-white/60 mb-8 max-w-md mx-auto">
                  {t.instructions}
                </p>
                <button
                  onClick={initGame}
                  className="group relative px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto"
                >
                  <Target className="w-5 h-5" />
                  {t.start}
                </button>
              </motion.div>
            </motion.div>
          )}

          {(status === GameStatus.WON || status === GameStatus.LOST) && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-8 text-center"
            >
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="space-y-6"
              >
                <h2 className={`text-5xl font-black tracking-tighter uppercase ${status === GameStatus.WON ? 'text-emerald-400' : 'text-red-500'}`}>
                  {status === GameStatus.WON ? t.youWin : t.gameOver}
                </h2>
                <div className="text-2xl font-mono">
                  {t.score}: {score}
                </div>
                <button
                  onClick={() => initGame()}
                  className="px-8 py-4 bg-white text-black font-bold rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto"
                >
                  <RotateCcw className="w-5 h-5" />
                  {t.playAgain}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Battery HUD */}
        <div className="absolute bottom-4 left-0 right-0 px-8 flex justify-between pointer-events-none">
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{t.left} (NUKE)</span>
            <div className={`h-1 w-20 rounded-full ${batteriesRef.current[0].active ? 'bg-red-500' : 'bg-red-500/30'}`} />
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{t.middle} (TRACK)</span>
            <div className={`h-1 w-20 rounded-full ${batteriesRef.current[1].active ? 'bg-yellow-500' : 'bg-red-500/30'}`} />
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{t.right} (WIDE)</span>
            <div className={`h-1 w-20 rounded-full ${batteriesRef.current[2]?.active ? 'bg-blue-500' : 'bg-blue-500/30'}`} />
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-8 text-white/20 text-[10px] uppercase tracking-[0.2em] flex gap-8">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          City Protected
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          Enemy Rocket
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          Interceptor
        </div>
      </div>
    </div>
  );
}
