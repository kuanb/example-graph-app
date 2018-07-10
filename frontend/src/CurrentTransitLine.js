import React, { Component, PropTypes } from 'react'

class CurrentTransitLine extends Component {

  constructor (props) {
    super(props);
  }

  shouldComponentUpdate(nextProps, nextState) {
    // TODO: For now, just assuming this updates once and that is it
    return false;
  }

  render() {
    // Nothing is rendered
    return null;
  }
}

export default CurrentTransitLine;