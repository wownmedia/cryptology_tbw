'use strict'

const network = require('../../lib/services/network.js')

describe('network.postTransaction', () => {
  it('should be a function', () => {
    expect(network.postTransaction).toBeFunction()
  })
})
