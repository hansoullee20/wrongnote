export class QueueError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "QueueError";
    this.code = code;
    Object.assign(this, details);
  }
}

export class QueueCommitError extends QueueError {
  constructor(message, details = {}) {
    super("committed_durability_uncertain", message, {
      committed: true,
      durability: "uncertain",
      ...details,
    });
    this.name = "QueueCommitError";
  }
}

export const fail = (code, message, details) => {
  throw new QueueError(code, message, details);
};
