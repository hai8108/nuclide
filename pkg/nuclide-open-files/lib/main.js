/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {FileVersion} from '../../nuclide-open-files-rpc/lib/rpc-types';
import type {ServerConnection} from '../../nuclide-remote-connection';
import type {FileNotifier} from '../../nuclide-open-files-rpc/lib/rpc-types';

import invariant from 'assert';
import {getLogger} from 'log4js';
import UniversalDisposable from 'nuclide-commons/UniversalDisposable';
import {
  observeBufferOpen,
  observeBufferCloseOrRename,
} from '../../commons-atom/text-buffer';
import {NotifiersByConnection} from './NotifiersByConnection';
import {BufferSubscription} from './BufferSubscription';

export class Activation {
  _disposables: UniversalDisposable;
  _bufferSubscriptions: Map<string, BufferSubscription>;
  notifiers: NotifiersByConnection;

  constructor(state: ?Object) {
    this._disposables = new UniversalDisposable();
    this._bufferSubscriptions = new Map();

    const notifiers = new NotifiersByConnection();
    this.notifiers = notifiers;
    this._disposables.add(notifiers);

    this._disposables.add(
      observeBufferOpen().subscribe(buffer => {
        const path = buffer.getPath();
        // Empty files don't need to be monitored.
        if (path == null || this._bufferSubscriptions.has(path)) {
          return;
        }
        const bufferSubscription = new BufferSubscription(notifiers, buffer);
        this._bufferSubscriptions.set(path, bufferSubscription);
        const subscriptions = new UniversalDisposable(bufferSubscription);
        subscriptions.add(
          observeBufferCloseOrRename(buffer).subscribe(closeEvent => {
            this._bufferSubscriptions.delete(path);
            this._disposables.remove(subscriptions);
            subscriptions.dispose();
          }),
        );
        this._disposables.add(subscriptions);
      }),
    );
  }

  getVersion(buffer: atom$TextBuffer): number {
    const path = buffer.getPath();
    invariant(path != null); // Guaranteed when called below.
    const bufferSubscription = this._bufferSubscriptions.get(path);
    if (bufferSubscription == null) {
      getLogger('nuclide-open-files').fatal(
        'Failed to get version of text buffer',
        buffer.getPath(),
      );
      return 0;
    }
    return bufferSubscription.getVersion();
  }

  dispose() {
    this._disposables.dispose();
    this._bufferSubscriptions.clear();
  }
}

// Mutable for testing.
let activation: ?Activation = new Activation();

// exported for testing
export function reset(): void {
  if (activation != null) {
    activation.dispose();
  }
  activation = null;
}

function getActivation() {
  if (activation == null) {
    activation = new Activation();
  }
  return activation;
}

export function getNotifierByConnection(
  connection: ?ServerConnection,
): Promise<FileNotifier> {
  return getActivation().notifiers.getForConnection(connection);
}

export async function getFileVersionOfBuffer(
  buffer: atom$TextBuffer,
): Promise<?FileVersion> {
  const filePath = buffer.getPath();
  const notifier = getActivation().notifiers.getForUri(filePath);
  if (notifier == null) {
    return null;
  }
  invariant(filePath != null);
  return {
    notifier: await notifier,
    filePath,
    version: getActivation().getVersion(buffer),
  };
}

export function getFileVersionOfEditor(
  editor: atom$TextEditor,
): Promise<?FileVersion> {
  return getFileVersionOfBuffer(editor.getBuffer());
}
