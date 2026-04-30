import { assertSupabaseResult, getUserScopedClient, normalizeLegacyUuid } from './supabaseCrud';

function toCalculatorResult(row) {
  return {
    id: row.id,
    calculatorId: row.tool_id,
    summary: row.summary,
    detail: row.detail,
    savedAt: row.created_at,
  };
}

export async function getCalculatorResults(calculatorId) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('calculator_results')
    .select('id, tool_id, summary, detail, created_at')
    .eq('tool_id', calculatorId)
    .order('created_at', { ascending: false });

  assertSupabaseResult({ error });
  return (data ?? []).map(toCalculatorResult);
}

export async function createCalculatorResult(calculatorId, result) {
  const { client, userId } = await getUserScopedClient();
  const id = normalizeLegacyUuid(result.id, 'result');

  const deleteResult = await client
    .from('calculator_results')
    .delete()
    .eq('tool_id', calculatorId)
    .eq('summary', result.summary)
    .eq('detail', result.detail);
  assertSupabaseResult(deleteResult);

  const insertResult = await client
    .from('calculator_results')
    .insert({
      ...(id ? { id } : {}),
      user_id: userId,
      tool_id: calculatorId,
      summary: result.summary,
      detail: result.detail,
      created_at: result.savedAt ?? result.created_at ?? new Date().toISOString(),
    });
  assertSupabaseResult(insertResult);

  return getCalculatorResults(calculatorId);
}

export async function deleteCalculatorResult(resultId) {
  const { client } = await getUserScopedClient();
  const result = await client.from('calculator_results').delete().eq('id', resultId);
  assertSupabaseResult(result);
}

export async function upsertCalculatorResult(calculatorId, result) {
  return createCalculatorResult(calculatorId, result);
}
