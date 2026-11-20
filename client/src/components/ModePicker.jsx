export const MODES = {
  host: { name: 'HOST ESCOLHE', desc: 'O host monta a lista de personagens; cada jogador sugere 1 nome, que é sorteado para o host. Aceita bots.' },
  players: { name: 'CADA UM ESCOLHE', desc: 'Todos (inclusive o host) escolhem 1 personagem. Cada escolha é sorteada para outro jogador, nunca para quem a fez. Sem bots.' },
  multi: { name: 'CADA UM ESCOLHE VÁRIOS', desc: 'Cada jogador escolhe de 1 a 3 personagens. O jogo sorteia 1 de cada seleção e distribui os sorteados: ninguém recebe o sorteado da própria seleção. Sem bots.' },
};

/** Seletor dos dois modos de partida (criação da sala e lobby do host). */
export function ModePicker({ value, onChange, disabled = false }) {
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-bold">Modo de partida</legend>
      {Object.entries(MODES).map(([key, m]) => (
        <label
          key={key}
          className={`cursor-pointer rounded-xl border-2 px-4 py-2.5 transition ${value === key ? 'border-felt bg-felt-light' : 'border-ink/10 bg-white hover:border-ink/25'}`}
        >
          <span className="flex items-center gap-2">
            <input type="radio" name="game-mode" value={key} checked={value === key} onChange={() => onChange(key)} className="accent-[#2f9e63]" />
            <span className="text-sm font-extrabold tracking-wide">{m.name}</span>
          </span>
          <span className="mt-0.5 block pl-6 text-xs font-medium text-ink/60">{m.desc}</span>
        </label>
      ))}
    </fieldset>
  );
}
