"use strict";

const postgres = require("../../src/services/postgres.js");

describe("postgres.connect", () => {
  it("should be a function", () => {
    expect(postgres.connect).toBeFunction();
  });
});

describe("postgres.close", () => {
  it("should be a function", () => {
    expect(postgres.close).toBeFunction();
  });
});

describe("postgres.query", () => {
  it("should be a function", () => {
    expect(postgres.query).toBeFunction();
  });
});
