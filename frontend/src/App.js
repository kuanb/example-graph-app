import React, { Component } from 'react'

import Map from './Map'
import currentNetworkShape from './data/act.json'

class App extends Component {
  render() {
    return <Map networkShape={currentNetworkShape} />
  }
}

export default App