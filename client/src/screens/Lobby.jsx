import { useEffect, useState } from 'react';
import { MODES, ModePicker } from '../components/ModePicker.jsx';
import { useGame } from '../game/GameContext.jsx';

const card = 'rounded-3xl bg-white/85 p-6 shadow-xl ring-1 ring-ink/5 backdrop-blur';

function HostBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-amber-800">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
        <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />
      </svg>
      Host
    </span>
  );
}

export default function Lobby() {
  const { state, leave, notify, removeBot } = useGame();
  const me = state.players.find((p) => p.id === state.you.id);
  const isHost = state.you.isHost;
  const link = `${window.location.origin}/?sala=${state.code}`;
  const picks = state.settings.mode !== 'host';

  return (
    <main className="mx-auto grid min-h-full max-w-5xl content-center gap-5 overflow-y-auto p-4 md:grid-cols-2 md:items-start">
      <section className={card}>
        <p className="text-xs font-extrabold uppercase tracking-widest text-ink/50">Código da sala</p>
        <p className="font-mono text-6xl font-black tracking-[0.25em] text-felt">{state.code}</p>
        <button
          className="mt-1 text-sm font-semibold text-ink/60 underline hover:text-ink"
          onClick={() => navigator.clipboard?.writeText(link).then(() => notify('Link de convite copiado!'), () => notify(link))}
        >
          Copiar link de convite
        </button>

        <h2 className="mb-2 mt-6 flex items-center justify-between text-lg font-extrabold">
          Jogadores
          <span className="text-sm font-semibold text-ink/50">{state.players.length}/10</span>
        </h2>
        <ul className="grid gap-2">
          {state.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-felt-light px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-white text-sm font-black text-felt shadow-sm">{p.nickname.slice(0, 1).toUpperCase()}</span>
                <span className="truncate font-bold">{p.nickname}</span>
                {p.id === me?.id && <span className="text-xs text-ink/50">você</span>}
                {p.isHost && <HostBadge />}
                {p.bot && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-ink/60">Bot</span>}
              </span>
              <span className="flex flex-none items-center gap-2 text-xs font-bold">
                {p.submitted !== null && !p.bot && (
                  <span className={p.submitted ? 'text-felt-dark' : 'text-ink/40'}>
                    {picks ? (p.submitted ? 'escolheu' : 'sem escolha') : p.submitted ? 'sugestão enviada' : 'sem sugestão'}
                  </span>
                )}
                {p.bot ? (
                  isHost && (
                    <button
                      aria-label={`Remover ${p.nickname}`}
                      onClick={async () => {
                        const res = await removeBot(p.id);
                        if (!res.ok) notify(res.error, 'error');
                      }}
                      className="rounded-md px-1.5 text-base font-bold leading-none text-red-500 hover:bg-white"
                    >
                      ×
                    </button>
                  )
                ) : (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${p.connected ? 'bg-felt' : 'bg-amber-400'}`}
                    title={p.connected ? 'online' : 'reconectando…'}
                    aria-label={p.connected ? 'online' : 'reconectando'}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>

        <button onClick={leave} className="mt-6 text-sm font-semibold text-red-600 hover:underline">
          {isHost ? 'Encerrar sala' : 'Sair da sala'}
        </button>
      </section>

      <section className={card}>{isHost ? <HostSetup /> : state.settings.mode === 'multi' ? <MultiPickForm /> : <SuggestionForm />}</section>
    </main>
  );
}

// ---------------------------------------------------------------- host

function HostSetup() {
  const { state, setSettings, setCharacters, start, notify, addBot } = useGame();
  const [busy, setBusy] = useState(false);
  const { characters, ready } = state.lobby;
  const lives = state.settings.lives;
  const mode = state.settings.mode;

  const run = async (fn) => {
    const res = await fn();
    if (!res.ok) notify(res.error, 'error');
    return res;
  };

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    await run(start);
    setBusy(false);
  };

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-xl font-extrabold">Configuração da partida</h2>
        <p className="text-sm text-ink/60">Você também joga: terá seu boneco, seu personagem e suas vidas.</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-ink/5 px-4 py-3">
        <span className="text-sm font-bold">Vidas (tentativas de chute)</span>
        <span className="flex items-center gap-3">
          <button aria-label="Menos uma vida" disabled={lives <= 1} onClick={() => run(() => setSettings({ lives: lives - 1 }))} className="h-8 w-8 rounded-lg bg-white text-lg font-black shadow-sm hover:bg-felt-light disabled:opacity-30">−</button>
          <b className="w-6 text-center text-xl tabular-nums">{lives}</b>
          <button aria-label="Mais uma vida" disabled={lives >= 10} onClick={() => run(() => setSettings({ lives: lives + 1 }))} className="h-8 w-8 rounded-lg bg-white text-lg font-black shadow-sm hover:bg-felt-light disabled:opacity-30">+</button>
        </span>
      </div>

      <ModePicker value={mode} onChange={(m) => run(() => setSettings({ mode: m }))} />
      {mode === 'players' && state.players.some((p) => p.bot) && (
        <p className="-mt-3 text-xs font-semibold text-amber-800">Remova os bots para usar este modo.</p>
      )}

      {mode === 'host' && (
      <>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-ink/5 px-4 py-3">
        <span className="text-sm font-bold">
          Bots <span className="font-semibold text-ink/50">({state.players.filter((p) => p.bot).length})</span>
        </span>
        <button
          disabled={state.players.length >= 10}
          onClick={() => run(addBot)}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold shadow-sm hover:bg-felt-light disabled:opacity-40"
        >
          Adicionar bot
        </button>
      </div>
      <p className="-mt-3 text-xs text-ink/50">Bots são jogadores controlados pelo servidor. Remova com o × na lista de jogadores.</p>

      <CharacterEditor list={characters ?? []} needed={ready.needed} onChange={(list) => run(() => setCharacters(list))} />
      </>
      )}

      {mode === 'players' && <SuggestionForm embedded />}
      {mode === 'multi' && <MultiPickForm embedded />}

      <div className="grid gap-3">
        {ready.ok ? (
          <p className="rounded-xl bg-felt-light px-4 py-2.5 text-sm font-bold text-felt-dark">Tudo pronto! Pode iniciar a partida.</p>
        ) : (
          <ul className="grid gap-1.5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" aria-label="O que falta para iniciar">
            {ready.missing.map((m) => (
              <li key={m} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          disabled={!ready.ok || busy}
          onClick={onStart}
          className="rounded-xl bg-felt py-3.5 text-lg font-bold text-white shadow-md hover:bg-felt-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Sorteando…' : 'Iniciar partida'}
        </button>
      </div>
    </div>
  );
}

function CharacterEditor({ list, needed, onChange }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null); // { index, value }
  const enough = list.length >= needed;

  const add = () => {
    const names = draft.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    onChange([...list, ...names]);
    setDraft('');
  };
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  const saveEdit = () => {
    if (!editing) return;
    const value = editing.value.trim();
    const original = list[editing.index];
    setEditing(null);
    if (value && value !== original) onChange(list.map((x, i) => (i === editing.index ? value : x)));
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor="new-characters" className="text-sm font-bold">
          Personagens para os jogadores
        </label>
        <span className={`text-xs font-extrabold ${enough ? 'text-felt-dark' : 'text-amber-700'}`}>
          {list.length} cadastrado{list.length === 1 ? '' : 's'} · precisa de {needed}
        </span>
      </div>

      <div className="flex gap-2">
        <textarea
          id="new-characters"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder={'Digite um ou vários nomes (um por linha)\nEnter adiciona'}
          className="min-w-0 flex-1 resize-none rounded-xl border-2 border-ink/10 bg-white px-3 py-2 text-sm outline-none focus:border-felt"
        />
        <button onClick={add} disabled={!draft.trim()} className="self-stretch rounded-xl bg-ink px-4 text-sm font-bold text-white hover:bg-black disabled:opacity-40">
          Adicionar
        </button>
      </div>

      <ul className="grid max-h-56 gap-1 overflow-y-auto pr-1">
        {list.length === 0 && <li className="rounded-lg bg-ink/5 px-3 py-3 text-center text-sm text-ink/50">Nenhum personagem cadastrado ainda.</li>}
        {list.map((name, i) => (
          <li key={`${i}-${name}`} className="flex items-center gap-2 rounded-lg bg-ink/5 px-3 py-1.5">
            {editing?.index === i ? (
              <input
                autoFocus
                aria-label={`Corrigir ${name}`}
                value={editing.value}
                maxLength={40}
                onChange={(e) => setEditing({ index: i, value: e.target.value })}
                onBlur={saveEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') setEditing(null);
                }}
                className="min-w-0 flex-1 rounded-md border border-felt bg-white px-2 py-0.5 text-sm outline-none"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
            )}
            <button aria-label={`Corrigir ${name}`} onMouseDown={(e) => e.preventDefault()} onClick={() => (editing?.index === i ? saveEdit() : setEditing({ index: i, value: name }))} className="rounded-md px-1.5 py-0.5 text-xs font-bold text-ink/60 hover:bg-white hover:text-ink">
              {editing?.index === i ? 'OK' : 'Editar'}
            </button>
            <button aria-label={`Remover ${name}`} onMouseDown={(e) => e.preventDefault()} onClick={() => remove(i)} className="rounded-md px-1.5 py-0.5 text-base font-bold leading-none text-red-500 hover:bg-white">
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- jogador comum

function SuggestionForm({ embedded = false }) {
  const { state, suggest, notify } = useGame();
  const picks = state.settings.mode !== 'host';
  const sent = state.lobby.mySuggestion;
  const [text, setText] = useState(sent ?? '');
  const [busy, setBusy] = useState(false);

  // ao reconectar, mostra de novo a sugestão que já estava salva
  useEffect(() => {
    if (sent) setText(sent);
  }, [sent]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy || !text.trim() || text.trim() === sent) return;
    setBusy(true);
    const res = await suggest(text);
    setBusy(false);
    if (!res.ok) notify(res.error, 'error');
  };

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-xl font-extrabold">{picks ? 'Escolha seu personagem' : 'Sugira um personagem'}</h2>
        <p className="mt-1 text-sm text-ink/60">
          {picks ? (
            <>
              Modo <b>{MODES.players.name}</b>. Escreva <b>um</b> personagem: ele será sorteado <b>para outro jogador</b>, nunca para você. O seu virá da escolha de alguém, e você descobre durante o jogo.
            </>
          ) : (
            <>
              Escreva <b>um</b> personagem. Ele será sorteado <b>para o host</b>, não para você. Seu personagem virá da lista que o host está montando, e você descobre durante o jogo.
            </>
          )}
        </p>
      </div>

      <form onSubmit={onSubmit} className="grid gap-3">
        <label htmlFor="suggestion" className="text-sm font-bold">
          {picks ? 'Seu personagem (1 só)' : 'Seu personagem para o sorteio'}
        </label>
        <input
          id="suggestion"
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: Shrek"
          autoComplete="off"
          className="w-full rounded-xl border-2 border-ink/10 bg-white px-4 py-3 text-lg outline-none focus:border-felt focus:ring-4 focus:ring-felt/15"
        />
        <button disabled={busy || !text.trim() || text.trim() === sent} className="rounded-xl bg-felt py-3 font-bold text-white shadow-md hover:bg-felt-dark disabled:cursor-not-allowed disabled:opacity-40">
          {sent ? (picks ? 'Trocar escolha' : 'Trocar sugestão') : picks ? 'Confirmar escolha' : 'Enviar sugestão'}
        </button>
      </form>

      {sent ? (
        <p className="animate-pop rounded-xl bg-felt-light px-4 py-2.5 text-sm font-bold text-felt-dark">
          {picks ? 'Escolha enviada' : 'Sugestão enviada'}: <span className="font-black">{sent}</span>. Só você e o servidor sabem.
        </p>
      ) : (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900">{picks ? 'A partida só começa depois que todos escolherem.' : 'O host só consegue iniciar depois que todos enviarem uma sugestão.'}</p>
      )}

      {!embedded && (
        <div className="flex items-center gap-3 border-t border-ink/10 pt-4 text-sm font-semibold text-ink/60">
          <span className="h-5 w-5 flex-none animate-spin rounded-full border-[3px] border-felt border-t-transparent" aria-hidden="true" />
          Aguardando o host iniciar a partida…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- modo CADA UM ESCOLHE VÁRIOS

const MAX_PICKS = 3;

function MultiPickForm({ embedded = false }) {
  const { state, setPicks, notify } = useGame();
  const confirmed = state.lobby.myPicks ?? [];
  const [draft, setDraft] = useState(() => [...confirmed, '', '', ''].slice(0, MAX_PICKS));
  const [busy, setBusy] = useState(false);

  // ao reconectar (ou ao desfazer), mostra a seleção que já estava salva
  useEffect(() => {
    if (confirmed.length) setDraft([...confirmed, '', '', ''].slice(0, MAX_PICKS));
  }, [confirmed.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const clean = [...new Set(draft.map((x) => x.trim()).filter(Boolean).map((x) => x.toLowerCase()))].length;
  const list = draft.map((x) => x.trim()).filter(Boolean);
  const changed = list.join('|') !== confirmed.join('|');

  const send = async (l) => {
    if (busy) return;
    setBusy(true);
    const res = await setPicks(l);
    setBusy(false);
    if (!res.ok) notify(res.error, 'error');
    return res;
  };

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-xl font-extrabold">Escolha até {MAX_PICKS} personagens</h2>
        <p className="mt-1 text-sm text-ink/60">
          Modo <b>{MODES.multi.name}</b>. Escreva de 1 a {MAX_PICKS} personagens diferentes. O jogo sorteia <b>1 da sua seleção</b> e esse personagem vai para <b>outro jogador</b>, nunca para você. Ninguém vê sua lista.
        </p>
      </div>

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (list.length && changed) send(list);
        }}
      >
        {draft.map((v, i) => (
          <label key={i} className="grid gap-1 text-sm font-bold">
            Personagem {i + 1} {i > 0 && <span className="font-semibold text-ink/40">(opcional)</span>}
            <input
              value={v}
              maxLength={40}
              onChange={(e) => setDraft((d) => d.map((x, k) => (k === i ? e.target.value : x)))}
              placeholder={['Ex.: Shrek', 'Ex.: Pikachu', 'Ex.: Napoleão'][i]}
              autoComplete="off"
              className="w-full rounded-xl border-2 border-ink/10 bg-white px-4 py-2.5 text-base font-normal outline-none focus:border-felt focus:ring-4 focus:ring-felt/15"
            />
          </label>
        ))}
        <div className="mt-1 flex gap-2">
          <button disabled={busy || !list.length || !changed || clean < list.length} className="flex-1 rounded-xl bg-felt py-3 font-bold text-white shadow-md hover:bg-felt-dark disabled:cursor-not-allowed disabled:opacity-40">
            {confirmed.length ? 'Atualizar escolhas' : 'Confirmar escolhas'}
          </button>
          {confirmed.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const r = await send([]);
                if (r?.ok) setDraft(['', '', '']);
              }}
              className="rounded-xl bg-ink/10 px-4 py-3 text-sm font-bold hover:bg-ink/20"
            >
              Desfazer
            </button>
          )}
        </div>
      </form>

      {confirmed.length ? (
        <div className="animate-pop rounded-xl bg-felt-light px-4 py-2.5 text-sm font-bold text-felt-dark">
          Escolhas confirmadas ({confirmed.length}/{MAX_PICKS}):{' '}
          <span className="font-black">{confirmed.join(' · ')}</span>. Só você e o servidor sabem.
        </div>
      ) : (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900">A partida só começa depois que todos confirmarem suas escolhas.</p>
      )}

      {!embedded && (
        <div className="flex items-center gap-3 border-t border-ink/10 pt-4 text-sm font-semibold text-ink/60">
          <span className="h-5 w-5 flex-none animate-spin rounded-full border-[3px] border-felt border-t-transparent" aria-hidden="true" />
          Aguardando o host iniciar a partida…
        </div>
      )}
    </div>
  );
}
