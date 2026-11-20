import { useMemo, useState } from 'react';
import { useGame } from '../game/GameContext.jsx';

const COLORS = ['#2f9e63', '#ffb020', '#e5484d', '#3b82f6', '#a855f7', '#fff176'];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 3,
        duration: 3 + Math.random() * 3,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 8,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 animate-fall rounded-sm"
          style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.6, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }}
        />
      ))}
    </div>
  );
}

export default function EndScreen() {
  const { state, reset, leave, notify } = useGame();
  const [hidden, setHidden] = useState(false);
  const isHost = state.you.isHost;
  const winner = state.players.find((p) => p.id === state.result?.winnerId);
  const iWon = winner?.id === state.you.id;

  if (hidden) {
    return (
      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-2">
        <button onClick={() => setHidden(false)} className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white shadow-lg">
          Ver resultado
        </button>
        {isHost && (
          <button
            onClick={async () => {
              const res = await reset();
              if (!res.ok) notify(res.error, 'error');
            }}
            className="rounded-xl bg-felt px-4 py-2 text-sm font-bold text-white shadow-lg"
          >
            Nova partida
          </button>
        )}
      </div>
    );
  }

  const title = iWon ? 'Você venceu!' : winner ? `${winner.nickname} descobriu quem era!` : 'Ninguém descobriu';
  const subtitle = winner
    ? `Era ${winner.character}.`
    : 'Todos os jogadores foram eliminados. Veja quem era quem:';

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink/60 p-4 backdrop-blur-sm">
      {winner && <Confetti />}
      <div className="animate-pop relative w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
        <p className="text-sm font-bold uppercase tracking-widest text-felt">Fim da partida</p>
        <h2 className="mt-1 text-3xl font-black leading-tight">{title}</h2>
        <p className="mt-1 text-ink/70">{subtitle}</p>

        <h3 className="mb-2 mt-5 text-left text-xs font-bold uppercase tracking-wide text-ink/50">Quem era quem</h3>
        <ul className="grid max-h-60 gap-1 overflow-y-auto text-left">
          {state.players.map((p) => (
            <li key={p.id} className={`flex justify-between rounded-lg px-3 py-1.5 ${p.id === winner?.id ? 'bg-felt-light font-bold' : 'bg-ink/5'}`}>
              <span>{p.nickname}</span>
              <span className="font-semibold">{p.character}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 grid gap-2">
          {isHost ? (
            <button
              onClick={async () => {
                const res = await reset();
                if (!res.ok) notify(res.error, 'error');
              }}
              className="rounded-xl bg-felt py-3 font-bold text-white hover:bg-felt-dark"
            >
              Nova partida
            </button>
          ) : (
            <p className="text-sm text-ink/60">Aguardando o host começar outra partida…</p>
          )}
          <div className="flex justify-center gap-4 text-sm font-semibold">
            <button onClick={() => setHidden(true)} className="text-ink/70 underline">
              Ver a mesa
            </button>
            <button onClick={leave} className="text-red-600 underline">
              Sair
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
