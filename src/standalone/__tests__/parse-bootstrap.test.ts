import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/parser', () => ({
  findLogsDirs: vi.fn(),
  parseAllLogsViaWorker: vi.fn(),
}));
vi.mock('../../core/analyzer', () => ({
  Analyzer: vi.fn(),
}));

import { findLogsDirs, parseAllLogsViaWorker } from '../../core/parser';
import { Analyzer } from '../../core/analyzer';
import { bootstrapParse } from '../parse-bootstrap';

const mockedFindLogsDirs = vi.mocked(findLogsDirs);
const mockedParseViaWorker = vi.mocked(parseAllLogsViaWorker);
const MockedAnalyzer = vi.mocked(Analyzer);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bootstrapParse', () => {
  it('returns an empty ParseResult without spawning a worker when no log dirs exist', async () => {
    mockedFindLogsDirs.mockReturnValue([]);

    const { parseResult } = await bootstrapParse(() => {});

    expect(parseResult.sessions).toEqual([]);
    expect(parseResult.workspaces.size).toBe(0);
    expect(parseResult.editLocIndex.size).toBe(0);
    expect(parseResult.sessionSourceIndex.size).toBe(0);
    expect(mockedParseViaWorker).not.toHaveBeenCalled();
    // The Analyzer is still constructed (over empty data) so the dashboard renders.
    expect(MockedAnalyzer).toHaveBeenCalledOnce();
  });

  it('parses via the worker and builds the Analyzer from its result', async () => {
    mockedFindLogsDirs.mockReturnValue(['/logs/a', '/logs/b']);
    const workerResult = {
      workspaces: new Map(),
      sessions: [],
      editLocIndex: new Map(),
      sessionSourceIndex: new Map(),
    };
    mockedParseViaWorker.mockResolvedValue(workerResult as never);

    const { parseResult } = await bootstrapParse(() => {});

    expect(mockedParseViaWorker).toHaveBeenCalledWith(['/logs/a', '/logs/b'], expect.any(Function));
    expect(parseResult).toBe(workerResult);
    expect(MockedAnalyzer).toHaveBeenCalledWith(
      workerResult.sessions,
      workerResult.editLocIndex,
      workerResult.workspaces,
    );
  });

  it('forwards worker progress to the caller callback', async () => {
    mockedFindLogsDirs.mockReturnValue(['/logs/a']);
    mockedParseViaWorker.mockResolvedValue({
      workspaces: new Map(),
      sessions: [],
      editLocIndex: new Map(),
      sessionSourceIndex: new Map(),
    } as never);
    const onProgress = vi.fn();

    await bootstrapParse(onProgress);

    // Grab the onProgress the worker received and fire it; the caller should see it.
    const workerOnProgress = mockedParseViaWorker.mock.calls[0][1] as (p: unknown) => void;
    workerOnProgress({ phase: 2, pct: 50, detail: 'parsing' });
    expect(onProgress).toHaveBeenCalledWith({ phase: 2, pct: 50, detail: 'parsing' });
  });
});
