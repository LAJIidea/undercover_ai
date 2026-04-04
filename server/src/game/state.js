// Game phases
export const GamePhase = {
  WAITING: 'waiting',
  CONFIGURING: 'configuring',
  ROUND_START: 'round_start',
  WORD_ASSIGNMENT: 'word_assignment',
  DISCUSSION: 'discussion',
  QUESTIONING: 'questioning',
  GUESSING: 'guessing',
  VOTING: 'voting',
  ROUND_RESULT: 'round_result',
  GAME_OVER: 'game_over',
};

// Team roles per round
export const TeamRole = {
  GAME_TEAM: 'game_team',
  OBSERVE_TEAM: 'observe_team',
};

// Player roles within a round
export const PlayerRole = {
  OMNISCIENT: 'omniscient',   // Knows the word in game team
  GUESSER: 'guesser',        // Doesn't know the word in game team
  OBSERVER: 'observer',       // Knows the word in observe team
  CAPTAIN: 'captain',         // Observer team captain (makes final vote)
};

export const TOTAL_ROUNDS = 3;
export const QUESTION_TIME_LIMIT_MS = 7 * 60 * 1000; // 7 minutes
export const DISCUSSION_TIME_MS = 45 * 1000; // 45 seconds

// Valid phase transitions
const TRANSITIONS = {
  [GamePhase.WAITING]: [GamePhase.CONFIGURING],
  [GamePhase.CONFIGURING]: [GamePhase.ROUND_START],
  [GamePhase.ROUND_START]: [GamePhase.WORD_ASSIGNMENT],
  [GamePhase.WORD_ASSIGNMENT]: [GamePhase.DISCUSSION],
  [GamePhase.DISCUSSION]: [GamePhase.QUESTIONING],
  [GamePhase.QUESTIONING]: [GamePhase.GUESSING, GamePhase.VOTING], // timeout or guess attempt
  [GamePhase.GUESSING]: [GamePhase.VOTING],
  [GamePhase.VOTING]: [GamePhase.ROUND_RESULT],
  [GamePhase.ROUND_RESULT]: [GamePhase.ROUND_START, GamePhase.GAME_OVER],
  [GamePhase.GAME_OVER]: [],
};

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function createInitialGameState(roomId) {
  return {
    roomId,
    phase: GamePhase.WAITING,
    currentRound: 0,
    totalRounds: TOTAL_ROUNDS,
    scores: { ai: 0, human: 0 },
    rounds: [],
    aiConfig: {
      players: [
        { id: 'ai_0', name: 'AI-Alpha', model: '', personality: 'analytical' },
        { id: 'ai_1', name: 'AI-Beta', model: '', personality: 'cautious' },
        { id: 'ai_2', name: 'AI-Gamma', model: '', personality: 'intuitive' },
        { id: 'ai_3', name: 'AI-Delta', model: '', personality: 'aggressive' },
      ],
      hostModel: '',
    },
    humanPlayers: [],
    wordConfig: {
      mode: 'preset', // 'preset' | 'ai' | 'mixed'
      aiRatio: 0.3,
    },
  };
}

export function createRoundState(roundNumber, gameState) {
  // Alternate teams: odd rounds AI is game team, even rounds human is game team
  const aiIsGameTeam = roundNumber % 2 === 1;
  const gameTeamType = aiIsGameTeam ? 'ai' : 'human';
  const observeTeamType = aiIsGameTeam ? 'human' : 'ai';

  // Only include connected human players in round participants
  const connectedHumans = gameState.humanPlayers.filter(p => p.connected).map(p => p.id);

  const gameTeamPlayers = aiIsGameTeam
    ? gameState.aiConfig.players.map(p => p.id)
    : connectedHumans;

  const observeTeamPlayers = aiIsGameTeam
    ? connectedHumans
    : gameState.aiConfig.players.map(p => p.id);

  // Random omniscient in game team
  const omniscientIndex = Math.floor(Math.random() * gameTeamPlayers.length);
  const omniscientId = gameTeamPlayers[omniscientIndex];

  // Random captain in observe team
  const captainIndex = Math.floor(Math.random() * observeTeamPlayers.length);
  const captainId = observeTeamPlayers[captainIndex];

  return {
    roundNumber,
    word: null,
    wordCategory: null,
    gameTeamType,
    observeTeamType,
    gameTeamPlayers,
    observeTeamPlayers,
    omniscientId,
    captainId,
    questions: [],
    discussions: [],
    questionCount: 0,
    guessAttempt: null,
    guessCorrect: false,
    voteTarget: null,
    voteCorrect: false,
    currentSpeakerIndex: 0,
    questionStartTime: null,
    scores: { gameTeam: 0, observeTeam: 0 },
  };
}
