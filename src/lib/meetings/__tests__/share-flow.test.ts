import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canSubmitSelection, confirmQuestion, selectionLabel, sentToast, UNDO_WINDOW_MS } from "../share-flow";

const page = readFileSync("src/components/meetings/MeetingsPanel.tsx", "utf8");
const dialog = page.slice(page.indexOf("function SendRecordingDialog"), page.indexOf("const DELETE_ERRORS"));

describe("Enviar reunião — regras", () => {
  it("não envia sem seleção", () => {
    expect(canSubmitSelection(new Set())).toBe(false);
    expect(canSubmitSelection([])).toBe(false);
  });
  it("1 usuário", () => {
    expect(canSubmitSelection(["a"])).toBe(true);
    expect(selectionLabel(1)).toBe("1 colaborador selecionado");
    expect(confirmQuestion(["Dani Oliveira"])).toBe("Deseja enviar esta reunião para Dani Oliveira?");
  });
  it("vários usuários", () => {
    expect(selectionLabel(2)).toBe("2 colaboradores selecionados");
    expect(confirmQuestion(["a", "b", "c"])).toBe("Deseja enviar esta reunião para estes 3 colaboradores?");
  });
  it("toast com quantidade correta e janela de 5s", () => {
    expect(sentToast(3)).toBe("Reunião enviada para 3 colaboradores.");
    expect(sentToast(1)).toBe("Reunião enviada para 1 colaborador.");
    expect(UNDO_WINDOW_MS).toBe(5000);
  });
});

describe("Enviar reunião — fluxo", () => {
  it("abrir/selecionar não envia; só Confirmar envio chama o servidor", () => {
    const toggle = dialog.slice(dialog.indexOf("const toggle"), dialog.indexOf("const confirmSend"));
    expect(toggle).not.toContain("rpc(");
    expect(dialog.match(/meeting_share_recording_batch/g)?.length).toBe(1);
    expect(dialog).toContain("onClick={confirmSend}");
    expect(dialog).toContain('onClick={() => setConfirming(true)}');
  });
  it("Cancelar só fecha a confirmação", () => {
    expect(dialog).toContain("onClick={() => setConfirming(false)}");
  });
  it("Desfazer usa o lote criado e expira com o aviso", () => {
    expect(dialog).toContain('"meeting_undo_share_batch"');
    expect(dialog).toContain("_batch_id: batchId");
    expect(dialog).toContain("duration: UNDO_WINDOW_MS");
    expect(dialog).not.toMatch(/deleteMeeting|meeting_participants/);
  });
});

import { accessBadge, buildAccessMap, validSelection } from "../share-flow";

describe("Enviar reunião — quem já possui", () => {
  const access = buildAccessMap([
    { user_id: "dani", kind: "participant" },
    { user_id: "tracy", kind: "shared" },
    { user_id: "dani", kind: "shared" },
  ]);
  it("participante e quem já recebeu ficam marcados com o badge certo", () => {
    expect(accessBadge(access.get("dani")!)).toBe("Já possui • Participou");
    expect(accessBadge(access.get("tracy")!)).toBe("Já possui • Recebida");
  });
  it("não podem ser selecionados nem contam no contador", () => {
    const v = validSelection(new Set(["dani", "tracy", "yasmin", "leo"]), access);
    expect([...v].sort()).toEqual(["leo", "yasmin"]);
  });
  it("linha esmaecida e checkbox desabilitado na tela", () => {
    expect(dialog).toContain("disabled={!!has}");
    expect(dialog).toContain("opacity-50 cursor-not-allowed");
    expect(dialog).toContain("!access.has(id) && setSelected");
  });
  it("busca não esconde quem já possui", () => {
    const f = dialog.slice(dialog.indexOf("const filtered"), dialog.indexOf("const validSelected"));
    expect(f).not.toContain("access");
  });
  it("só envia selecionados válidos e o aviso usa os criados de fato", () => {
    expect(dialog).toContain("_recipient_ids: Array.from(validSelected)");
    expect(dialog).toContain("sentToast(created.length)");
  });
});
