/**
 * @file user-connection.port.ts
 * @description Shared port for closing a user's live realtime connections.
 *
 * Feature modules must not import one another (AGENTS.md rule 5), but several
 * of them need the same capability: when an account is suspended or its MFA is
 * administratively reset, every HTTP credential is revoked — and the realtime
 * transport authenticates a socket once, at connect time, so an already-open
 * connection would otherwise survive the revocation.
 *
 * `users/` and `platform/` therefore depend on this abstraction rather than on
 * the notifications gateway itself. It states what those features need — end
 * this user's connections — without telling them a transport exists, so the
 * gateway can change or be replaced without either feature noticing.
 *
 * @layer realtime
 */

/** DI token for {@link UserConnectionPort}. */
export const USER_CONNECTION_PORT = Symbol('USER_CONNECTION_PORT');

/**
 * Closes the live connections belonging to a user.
 *
 * @public
 */
export interface UserConnectionPort {
  /**
   * Immediately closes every open connection for the user.
   *
   * Call after an action that revokes their credentials, so a socket opened
   * beforehand cannot keep streaming.
   *
   * @param userId - The user whose connections should be closed.
   */
  disconnectUser(userId: string): void;

  /**
   * Closes the user's connections only when the new status blocks access.
   *
   * Lets a status-change caller stay out of the business of deciding which
   * statuses count as blocked.
   *
   * @param userId - The user whose status changed.
   * @param newStatus - The status just written.
   */
  maybeDisconnectBlockedUser(userId: string, newStatus: string): void;
}
