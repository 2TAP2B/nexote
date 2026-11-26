# Spaces and accounts

Nexote is multi-user. People sign in with passkeys, and notes are organized in spaces that can be private or shared.

## Passkeys

There are no passwords. Every account signs in with a passkey: a key pair stored by the device, a password manager or a security key, unlocked with a fingerprint, face or PIN. The server stores only the public key.

- **Sign in with a passkey** needs no username; the browser offers the passkeys it has for this site.
- **Settings › Account** lists your passkeys. You can add more (for example one per device), rename them and remove them. The last passkey of an account cannot be removed.
- Passkeys are bound to the host name in `NEXOTE_PUBLIC_URL` and need https or `localhost`. See [Reverse proxy and https](../guide/getting-started#reverse-proxy-and-https).

Sessions last 30 days after the last use. When a session ends while the app is open, a "Signed out" overlay appears and the open notes stay on screen until you sign in again.

## Profile

**Settings › Account › Profile** holds your display name and a profile picture. Upload any photo; the browser crops it to a centered square and scales it down before uploading (PNG, JPEG, GIF or WebP, up to 2 MB). The picture appears on your account button and in space member lists; without one, or when it can't be loaded (offline), your initials show instead.

## Server roles

Each account has one of two roles on the server:

| Role | Can do |
| --- | --- |
| Admin | Everything a member can, plus: manage accounts, create invite and recovery links, configure git sync and the metadata lookup keys. |
| Member | Use the spaces they belong to and create their own spaces. |

The first account, created with the setup code from the server log, is an admin. The server always keeps at least one active admin. The **Users**, **Metadata lookup** and **Git sync** settings pages are only shown to admins.

## Invites

Admins add people with invite links in **Settings › Users › Invite someone**:

- Choose the role (Member or Admin) and create the link. It is shown once.
- The link works once and is valid for 7 days. Pending links are listed under **Links** and can be revoked.
- The person opening the link chooses a username and creates a passkey. Someone who is already signed in on that browser has to sign out first.

## Recovery links

A recovery link adds a new passkey to an existing account, for someone who lost their devices. It works once and is valid for 24 hours. Admins create one from the account's row in **Settings › Users**; on the server it can also be created with `nexote-backend recover <username>`. See [Account recovery](../guide/getting-started#account-recovery).

## Managing accounts

In **Settings › Users**, admins can change an account's role and deactivate or reactivate it. Deactivating signs the person out everywhere, and a deactivated account cannot sign in or sync from a paired phone. Admins cannot deactivate their own account.

## Paired devices

**Settings › Devices** connects the [Android app](./android-app) to your account and lists the paired phones with their last contact. **Connect** shows a QR code and a link with a one-time code, valid for 10 minutes. A paired phone gets a key that only works for syncing, never for signing in or changing the account. **Disconnect** revokes it at once.

Server-side, invite and session tokens, pairing codes and device keys are stored only as SHA-256 hashes.

## Spaces

A space is a workspace with its own vaults, collections and members. The desktop ribbon shows the active space at the bottom; on the phone, spaces are the leftmost pane of the [mobile app](./mobile-app).

- Creating a space makes you its owner and creates a **Notes** vault and a **Collections** vault in it.
- A space with only its owner as member is private.
- Someone without any space automatically gets a private "Personal" space.
- Switching spaces switches the vaults, the note tree and the open tabs.

Your journal and the [Notepad](./quick-notes) (by default) are personal: they belong to your account, not to a space, and are the same in every space.

### Space roles

| Role | Can do |
| --- | --- |
| Viewer | Read the space's notes. Notes open read-only, marked "View only". |
| Editor | Create, edit, move and delete notes; create and rename vaults. |
| Owner | Everything an editor can, plus: rename the space and change its icon, manage members, delete vaults, delete the space. |

A space that you are not a member of does not exist for you: the server answers with "not found".

### Members

In the space settings, owners add people by searching existing accounts and give them the Editor or Viewer role. Owners can change roles (Owner, Editor, Viewer) and remove members. Deactivated accounts cannot be added.

Any member can leave a space, except its only owner; every space needs an owner. Deleting a space requires typing its name and removes its vaults and notes for every member. You cannot delete your only space.
