import { useEffect, useState } from 'react';
import SoundToggle from '../components/SoundToggle.jsx';
import { useCountdown, useGame } from '../game/GameContext.jsx';
import ActionPanel from './ActionPanel.jsx';
import Notebook from './Notebook.jsx';

export default function HUD() {
  const { state, leave } = useGame();
  const me = state.players.find((p) => p.id === state.you.id);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-2 p-3 text-ink">
      <div className="flex items-start justify-between gap-3">
        <PlayerStrip />
        <TurnBanner />
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          {me && <Lives lives={me.lives} max={state.settings.lives} />}
          <div className="flex gap-2">
            <SoundToggle />
            {confirming ? (
              <span className="flex items-center gap-1 rounded-lg bg-white/95 px-2 py-1 text-xs font-bold shadow">
                {state.you.isHost ? 'Encerrar a sala?' : 'Sair?'}
                <button onClick={leave} className="rounded bg-red-600 px-2 py-1 text-white">Sim</button>
                <button onClick={() => setConfirming(false)} className="rounded bg-ink/10 px-2 py-1">Não</button>
              </span>
            ) : (
              <button onClick={() => setConfirming(true)} className="rounded-lg bg-white/85 px-3 py-1.5 text-xs font-bold shadow hover:bg-white">
                Sair
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-stretch justify-end gap-2 md:flex-row md:items-end md:justify-between">
        <div className="pointer-events-auto order-2 md:order-1 md:w-80">
          <Notebook />
        </div>
        <div className="pointer-events-auto order-1 flex-1 md:order-2 md:max-w-md">
          <ActionPanel />
        </div>
        <div className="hidden md:block md:w-80" aria-hidden="true" />
      </div>
    </div>
  );
}

function Lives({ lives, max }) {
  const [shake, setShake] = useState(false);
  const [prev, setPrev] = useState(lives);
  useEffect(() => {
    if (lives < prev) {
      setShake(true);
      const id = setTimeout(() => setShake(false), 650);
      setPrev(lives);
      return () => clearTimeout(id);
    }
    setPrev(lives);
    return undefined;
  }, [lives]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex gap-1 rounded-xl bg-white/90 px-3 py-1.5 shadow" aria-label={`${lives} de ${max} vidas`} title="Suas vidas">
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" className={`h-6 w-6 ${shake && i === lives ? 'animate-heart-break' : ''}`} aria-hidden="true">
          <path
            d="M12 21s-7.5-4.6-9.6-9.1C.9 8.5 2.6 5 6 5c2.1 0 3.4 1.1 4.2 2.3L12 9.6l1.8-2.3C14.6 6.1 15.9 5 18 5c3.4 0 5.1 3.5 3.6 6.9C19.5 16.4 12 21 12 21z"
            fill={i < lives ? '#e5484d' : '#d4d9d6'}
            style={{ transition: 'fill .3s' }}
          />
        </svg>
      ))}
    </div>
  );
}

function PlayerStrip() {
  const { state } = useGame();
  return (
    <ul className="pointer-events-auto hidden max-h-[40vh] min-w-44 gap-1 overflow-y-auto rounded-2xl bg-white/90 p-2 shadow sm:grid" aria-label="Jogadores">
      {state.players.map((p) => {
        const isTurn = state.turn?.playerId === p.id;
        return (
          <li key={p.id} className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm transition ${isTurn ? 'bg-amber-100 font-bold' : ''} ${p.eliminated ? 'opacity-50' : ''}`}>
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${p.connected ? 'bg-felt' : 'bg-amber-400'}`} title={p.connected ? 'online' : 'reconectando'} />
              <span className={p.eliminated ? 'line-through' : ''}>{p.nickname}</span>
              {p.id === state.you.id && <span className="text-[10px] text-ink/50">você</span>}
              {p.isHost && <span className="text-[10px] font-extrabold text-amber-700">HOST</span>}
              {p.bot && <span className="text-[10px] font-extrabold text-ink/50">BOT</span>}
            </span>
            <span className="text-xs text-red-500">{p.eliminated ? 'fora' : '♥'.repeat(p.lives)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function TurnBanner() {
  const { state } = useGame();
  const { turn, players } = state;
  const left = useCountdown(turn?.deadline);
  const current = players.find((p) => p.id === turn?.playerId);
  if (!turn || !current) return <div className="flex-1" />;

  const C = 2 * Math.PI * 22;
  const frac = turn.duration ? Math.min(1, (left * 1000) / turn.duration) : 0;
  const acting = turn.step === 'action';
  const urgent = left <= 5 && acting;
  const mine = current.id === state.you.id;

  return (
    <div className="pointer-events-none flex flex-1 justify-center">
      <div className={`pointer-events-auto flex items-center gap-3 rounded-2xl bg-white/95 py-2 pl-4 pr-3 shadow-lg ${mine && acting ? 'animate-turn-pulse' : ''}`}>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Vez de</p>
          <p className="text-lg font-black leading-tight">
            {current.nickname}
            {mine && <span className="ml-2 text-sm font-semibold text-felt">(você)</span>}
          </p>
        </div>
        {acting && (
          <div className="relative h-14 w-14" role="timer" aria-label={`${left} segundos restantes`}>
            <svg viewBox="0 0 52 52" className="h-14 w-14 -rotate-90">
              <circle cx="26" cy="26" r="22" fill="none" stroke="#e3e8e5" strokeWidth="5" />
              <circle
                cx="26"
                cy="26"
                r="22"
                fill="none"
                stroke={urgent ? '#e5484d' : '#2f9e63'}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${frac * C} ${C}`}
                style={{ transition: 'stroke-dasharray .25s linear' }}
              />
            </svg>
            <span className={`absolute inset-0 grid place-items-center text-lg font-black tabular-nums ${urgent ? 'text-red-600' : ''}`}>{left}</span>
          </div>
        )}
      </div>
    </div>
  );
}
