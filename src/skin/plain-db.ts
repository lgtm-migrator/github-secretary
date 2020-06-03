import { promises } from 'fs';
import MutexPromise from 'mutex-promise';

import {
  GitHubUser,
  DiscordId,
  GitHubUsers,
  NotificationId,
  cloneGitHubUsers,
} from '../exp/github-user';
import { Database, UpdateHandler } from 'src/abst/subscription-database';

const { open, mkdir } = promises;

export class PlainDB implements Database {
  private users: GitHubUsers = {};
  private mutex: MutexPromise;
  private handlers: UpdateHandler[] = [];

  private constructor(fileName: string, private handle: promises.FileHandle) {
    this.mutex = new MutexPromise(`plain-db-${fileName}`);
  }

  onUpdate(handler: UpdateHandler): void {
    this.handlers.push(handler);
  }

  static async make(fileName: string): Promise<PlainDB> {
    const handle = await open(fileName, 'r+').catch(async () => {
      await mkdir('.cache');
      return await open(fileName, 'w+');
    });
    const obj = new PlainDB(fileName, handle);
    try {
      const buf = await handle.readFile();
      const previousUsers = JSON.parse(buf.toString());
      obj.users = previousUsers.users;
    } catch (ignore) {
      obj.users = {};
    }
    return obj;
  }

  async register(id: DiscordId, user: GitHubUser): Promise<void> {
    this.users[id] = user;
    await this.overwrite();
  }

  async unregister(id: DiscordId): Promise<boolean> {
    if (this.users[id] == null) {
      return false;
    }
    delete this.users[id];
    await this.overwrite();
    return true;
  }

  async update(id: string, notificationIds: NotificationId[]): Promise<void> {
    if (this.users[id] == null) {
      return;
    }
    this.users[id].currentNotificationIds = notificationIds;
    await this.overwrite();
  }

  private async overwrite(): Promise<void> {
    await this.mutex
      .promise()
      .then(() => this.handle.truncate(0))
      .then(() => this.handle.write(JSON.stringify({ users: this.users }), 0));

    const newUsers = cloneGitHubUsers(this.users);
    await Promise.all(
      this.handlers.map((handler) => async () => {
        handler.handleUpdate(newUsers);
      }),
    );
  }
}
