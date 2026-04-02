export default function PlayerCard({
  player, isAI, isSpeaking, isOmniscient, isCaptain, isVoteTarget,
}) {
  const borderClass = isSpeaking ? 'border-accent animate-pulse-glow'
    : isOmniscient ? 'border-yellow-500'
    : isVoteTarget ? 'border-red-500'
    : 'border-card-border';

  const bgClass = isAI ? 'bg-gradient-to-b from-red-950/30 to-card-bg'
    : 'bg-gradient-to-b from-blue-950/30 to-card-bg';

  return (
    <div className={`${bgClass} border ${borderClass} rounded-xl p-3 text-center transition-all duration-300 relative`}>
      {/* Avatar */}
      <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center text-xl font-bold mb-2
        ${isAI ? 'bg-red-900/50 text-red-300' : 'bg-blue-900/50 text-blue-300'}`}>
        {isAI ? '🤖' : player.name?.[0] || '?'}
      </div>

      {/* Name */}
      <p className="text-sm font-medium truncate">
        {player.name}
      </p>

      {/* Personality tag for AI */}
      {isAI && player.personality && (
        <p className="text-xs text-gray-500 mt-0.5">
          {({ analytical: '分析', cautious: '谨慎', intuitive: '直觉', aggressive: '积极' })[player.personality]}
        </p>
      )}

      {/* Status badges */}
      <div className="flex justify-center gap-1 mt-1">
        {isSpeaking && (
          <span className="text-xs bg-accent/20 text-accent px-1.5 rounded">发言中</span>
        )}
        {isCaptain && (
          <span className="text-xs bg-purple-900/50 text-purple-300 px-1.5 rounded">队长</span>
        )}
        {isOmniscient && (
          <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1.5 rounded">全知者</span>
        )}
      </div>

      {/* Connection status for humans */}
      {!isAI && (
        <div className={`absolute top-2 right-2 w-2 h-2 rounded-full
          ${player.connected !== false ? 'bg-green-400' : 'bg-red-400'}`}
        />
      )}
    </div>
  );
}
