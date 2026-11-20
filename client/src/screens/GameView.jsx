import { useGameSounds } from '../audio/useGameSounds.js';
import { useGame } from '../game/GameContext.jsx';
import EndScreen from '../hud/EndScreen.jsx';
import DrawIntro from '../hud/DrawIntro.jsx';
import HUD from '../hud/HUD.jsx';
import Scene from '../three/Scene.jsx';

export default function GameView() {
  const { state, reactions } = useGame();
  useGameSounds();

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        <Scene state={state} reactions={reactions} />
      </div>
      <HUD />
      <DrawIntro />
      {state.phase === 'finished' && <EndScreen />}
    </div>
  );
}
