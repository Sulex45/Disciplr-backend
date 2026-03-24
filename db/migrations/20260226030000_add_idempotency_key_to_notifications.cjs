/**
 * Migration: add idempotency_key column and partial unique index to notifications table.
 * The partial index (WHERE idempotency_key IS NOT NULL) ensures NULL rows never collide,
 * preserving backward compatibility with existing notifications.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('notifications', (table) => {
    table.string('idempotency_key', 255).nullable()
  })

  await knex.raw(`
    CREATE UNIQUE INDEX uq_notifications_user_idempotency_key
    ON notifications (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `)
}

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS uq_notifications_user_idempotency_key')

  await knex.schema.alterTable('notifications', (table) => {
    table.dropColumn('idempotency_key')
  })
}
