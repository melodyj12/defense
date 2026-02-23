export enum GameStatus {
  START = 'START',
  PLAYING = 'PLAYING',
  WON = 'WON',
  LOST = 'LOST',
}

export interface Point {
  x: number;
  y: number;
}

export interface Rocket {
  id: string;
  start: Point;
  current: Point;
  target: Point;
  speed: number;
  color: string;
}

export interface Missile {
  id: string;
  start: Point;
  current: Point;
  target: Point;
  speed: number;
  batteryIndex: number;
  targetRocketId?: string;
}

export interface Explosion {
  id: string;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  growing: boolean;
}

export interface Battery {
  x: number;
  y: number;
  missiles: number;
  maxMissiles: number;
  active: boolean;
}

export interface City {
  x: number;
  active: boolean;
}

export type Language = 'en' | 'zh';

export interface PowerUp {
  id: string;
  x: number;
  y: number;
  type: 'AMMO' | 'SUGAR';
  createdAt: number;
  duration: number;
}

export interface Translations {
  title: string;
  start: string;
  score: string;
  missiles: string;
  gameOver: string;
  youWin: string;
  playAgain: string;
  instructions: string;
  description: string;
  descriptionTitle: string;
  close: string;
  left: string;
  middle: string;
  right: string;
}
