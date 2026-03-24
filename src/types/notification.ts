export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  data?: any
  idempotency_key: string | null
  read_at: string | null
  created_at: string
}

export interface CreateNotificationInput {
  user_id: string
  type: string
  title: string
  message: string
  data?: any
  idempotency_key?: string
}
