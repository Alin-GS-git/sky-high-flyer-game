
export enum GameStatus {
  START = 'START',
  PLAYING = 'PLAYING',
  GAME_OVER = 'GAME_OVER'
}

export enum ObstacleType {
  STATIC_CLOUD = 'STATIC_CLOUD',
  FAST_BIRD = 'FAST_BIRD',
  OSCILLATING_BALLOON = 'OSCILLATING_BALLOON',
  FALLING_SATELLITE = 'FALLING_SATELLITE',
  BOMB = 'BOMB',
  BOOST_STAR = 'BOOST_STAR'
}

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: ObstacleType;
  passed: boolean;
  // Movement specific properties
  initialY?: number;
  phase?: number;
  verticalSpeed?: number;
  spawnTime: number;
}

export interface Cloud {
  id: string;
  x: number;
  y: number;
  scale: number;
  speed: number;
}

export interface GameState {
  score: number;
  highScore: number;
  status: GameStatus;
  planeY: number;
  planeTilt: number;
  obstacles: Obstacle[];
  clouds: Cloud[];
}
