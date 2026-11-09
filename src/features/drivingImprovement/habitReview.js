const adjustmentTargets = {
  'Wrong timing': [{ label: 'Change timing', target: 'timing' }],
  'No time': [{ label: 'Change timing', target: 'timing' }],
  'Low energy': [{ label: 'Change timing', target: 'timing' }],
  Forgot: [{ label: 'Change trigger', target: 'cue' }],
  Environment: [{ label: 'Change environment', target: 'environment' }],
};

export function getReviewAdjustments(stats) {
  if ((stats?.recentMisses || 0) < 3) return [];
  return [
    { label: 'Make smaller', target: 'minimum' },
    ...(adjustmentTargets[stats.commonReason] || []),
  ];
}
