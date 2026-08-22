export const GENERIC_ADAPTER = Object.freeze({
  id: 'generic',
  script: null,
  command: null,
  statePrefix: null,
  tracePolicy: {
    skipFiles: [],
    skipFunctions: []
  },
  shouldFinish: () => false
});

export const PUSH_SWAP_ADAPTER = Object.freeze({
  id: 'push_swap',
  script: 'push_swap.py',
  command: 'cvis-push-swap-state',
  statePrefix: 'CVIS_PUSH_SWAP_STATE ',
  tracePolicy: {
    skipFiles: ['src/utils.c', 'src/print_numbers.c', 'src/benchmark.c'],
    skipFunctions: [
      'ft_strlen',
      'ft_strcmp',
      'ft_isspace',
      'ft_isdigit',
      'ft_putstr_fd',
      'ft_putnbr_fd',
      'ft_put_percent_fd'
    ]
  },
  shouldFinish(snapshot) {
    if (snapshot?.status !== 'paused') return false;
    return snapshot.frame?.func === 'do_op'
      && snapshot.frame?.projectPath === 'src/op_dispatch.c'
      && Number(snapshot.frame?.line) >= 122;
  }
});

export function adapterFor(profile) {
  return profile === 'push_swap' ? PUSH_SWAP_ADAPTER : GENERIC_ADAPTER;
}
