export function enableTransferCommandContext(tx) {
  if (!tx || typeof tx.$queryRaw !== 'function') {
    throw new TypeError(
      'enableTransferCommandContext requires a Prisma transaction client',
    )
  }

  return tx.$queryRaw`
    SELECT set_config('bold.transfer_command', 'on', true)
  `
}
