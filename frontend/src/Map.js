import React, { Component } from 'react';
import _ from 'lodash';
import axios from 'axios';

import defaultTheme from 'mapbox-gl-draw/src/lib/theme.js';
import MapboxGl from 'mapbox-gl/dist/mapbox-gl.js';
import MapboxDraw from 'mapbox-gl-draw';
import mbxClient from '@mapbox/mapbox-sdk';
import mbxMapMatching from '@mapbox/mapbox-sdk/services/map-matching';

// Also load in css
import 'mapbox-gl/dist/mapbox-gl.css'
import 'mapbox-gl-draw/dist/mapbox-gl-draw.css'

const MAPBOX_PUBLIC_TOKEN = 'pk.eyJ1Ijoia3VhbmIiLCJhIjoidXdWUVZ2USJ9.qNKXXP6z9_fKA8qrmpOi6Q';
const MAPBOX_ACT_TILESET = 'kuanb.cjjf78ofn00656wqfklj2zj9g-9cpqi';

class Map extends Component {
  constructor (props) {
    super(props);

    this.updateCustomLine = this.updateCustomLine.bind(this);
    this.updateFromDelete = this.updateFromDelete.bind(this);
    this.makeRunButton = this.makeRunButton.bind(this);
    this.makeGraphAnalysisQuery = this.makeGraphAnalysisQuery.bind(this);

    // Initialize state on component mount
    this.state = {
      map: null,
      draw: null,
      addedRoutes: {
        type: 'FeatureCollection',
        features: [],
      },
      buttonValue: 'Run network analysis',
    };
  }

  // Once mounted, bring up the mapbox map
  componentDidMount() {
    // TODO: Move this to a parameter
    MapboxGl.accessToken = MAPBOX_PUBLIC_TOKEN;

    // Create the map object
    const map = new MapboxGl.Map({
      container: this.container,
      style: 'mapbox://styles/mapbox/dark-v9',
    })

    // Also add draw to the map
    var draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        line_string: true,
        trash: true
      },
      styles: generateCustomDrawStyles(defaultTheme, [{
        id: 'gl-draw-line-inactive',
        type: 'line',
        filter: ['all',
          ['==', 'active', 'false'],
          ['==', '$type', 'LineString'],
          ['!=', 'mode', 'static']
        ],
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#FF0000',
          'line-width': 5
        }
      }, {
        id: 'gl-draw-line-static',
        type: 'line',
        filter: ['all',
          ['==', '$type', 'LineString'],
          ['==', 'mode', 'static']]
        ,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': '#FF0000',
          'line-width': 5
        }
      }])
    });
    map.addControl(draw);

    // Also add bindings that fire when a new point is added
    map.on('draw.create', this.updateCustomLine);
    map.on('draw.update', this.updateCustomLine);
    map.on('draw.delete', this.updateFromDelete);

    // Center the project (again, this might be parameterized)
    map.flyTo({ center: [-122.27, 37.8], zoom: 12 });

    // Once the map is loaded, set the state to track the map
    map.on('load', () => {
      this.setState({ map, draw });

      // // Also add GeoJSON of the base network to the map
      const { networkShape } = this.props;
      // networkShape.features.forEach(function (line) {
      //   const id = line.properties.id;
      //   map.addLayer({
      //     id: `route_${id}`,
      //     type: 'line',
      //     source: {
      //       type: 'geojson',
      //       data: simplifyLine(line),
      //       tolerance: 2,
      //     },
      //     layout: {
      //       'line-join': 'round',
      //       'line-cap': 'round'
      //     },
      //     paint: {
      //       'line-color': generateRandomColor(),
      //       'line-width': 1
      //     },
      //   });
      // });

      networkShape.features = networkShape.features.map(line => {
        line.properties.color = generateRandomColor();
        return simplifyLine(line);
      })
      map.addLayer({
        id: 'originalRoutes',
        type: 'line',
        source: {
          type: 'geojson',
          data: networkShape,
          tolerance: 2,
        },
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': {
            property: 'color',
            type: 'identity'
          },
          'line-width': 1
        },
      });

      // And add a placeholder source for when we get responses from
      // the backend from analysis runs
      map.addSource('analysisResults', {
          type: "geojson",
          data: makeEmptyFeatureCollection(),
      });

      map.addLayer({
        id: 'analysisResults',
        source: 'analysisResults',
        type: 'circle',
        paint: {
          'circle-color': {
            stops: [
              [-1.0, '#ff0000'],
              [-0.8, '#ff0000'],
              [-0.6, '#ff0000'],
              [-0.4, '#ff0000'],
              [-0.2, '#ff0000'],
              [0.0, '#cccccc'],
              [0.2, '#00ff04'],
              [0.4, '#00ff04'],
              [0.6, '#00ff04'],
              [0.8, '#00ff04'],
              [1.0, '#00ff04'],
            ]
          },
          'circle-radius': {
            property: 'percent_change',
            type: 'exponential',
            stops: [
              [-1.0, 32],
              [-0.8, 16],
              [-0.6, 8],
              [-0.4, 4],
              [-0.2, 2],
              [-0.0, 1],
              [0.0, 1],
              [0.2, 2],
              [0.4, 4],
              [0.6, 8],
              [0.8, 16],
              [1.0, 32],
            ]
          },
          'circle-opacity': 0.8
        }
      });
    })
  }

  updateFromDelete (e) {
    const draw = this.state.draw;
    this.setState({ addedRoutes: draw.getAll(), });
  }

  updateCustomLine (e) {
    const draw = this.state.draw;
    const baseClient = mbxClient({ accessToken: MAPBOX_PUBLIC_TOKEN });
    const mapMatchingService = mbxMapMatching(baseClient);

    const feature = e.features[0];
    const points = feature.geometry.coordinates.map((coord) => {
      return {
        coordinates: [coord[0], coord[1]],
      }
    });
    
    mapMatchingService.getMatching({
      tidy: false,
      profile: 'driving',
      geometries: 'geojson',
      steps: false,
      points,
    }).send().then(response => {
      const matching = response.body;
      if (matching.matchings.length) {
        // In this case, add the matched map to the draw
        // created shapes
        draw.add(matching.matchings[0].geometry);

        // And also delete the current drawn feature
        draw.delete(feature.id);
      }

      // Update the state with the latest feature collection
      this.setState({ addedRoutes: draw.getAll(), });
    });
  }

  makeRunButton () {
    return (
      <div className='run-analysis-button'
           onClick={this.makeGraphAnalysisQuery}>
        {this.state.buttonValue}
      </div>
    );
  }

  // Speed up re-renders by specifying what we need
  // React to keep track of
  shouldComponentUpdate(nextProps, nextState) {
    const a = nextState.addedRoutes !== this.state.addedRoutes;
    return a;
  }

  makeGraphAnalysisQuery () {
    const ar = this.state.addedRoutes;

    axios.post('http://127.0.0.1:5000/analyze', ar)
    .then(res => {
      // Do something with the result
      console.log('returned!', this.state.map, res.data);
      this.state.map.getSource('analysisResults').setData(res.data);
    })
  }

  render() {
    // Note use of ref here allows us to pass the container to
    // the mapbox mount step
    const fs = this.state.addedRoutes.features;
    return (
      <div className='mapbox-map'
           ref={(x) => { this.container = x }}>
        { fs && fs.length ? this.makeRunButton() : null }
      </div>
    )
  }
}

function generateRandomColor() {
  const base = '000000';
  const addVal = Math.random().toString(16).slice(2, 8).toUpperCase();
  const hexVal = (base + addVal).slice(-6);
  return `#${hexVal}`;
}

function simplifyLine(line) {
  const newCoords = line.geometry.coordinates.map((coords) => {
    return coords.map((c) => {
      const accuracy = 10000;
      return (Math.round(c * accuracy) / accuracy);
    })
  });
  line.geometry.coordinates = newCoords;
  return line;
}

function generateCustomDrawStyles(defaultTheme, newStyles) {
  let newTheme = defaultTheme.slice();

  newStyles.forEach(newStyle => {
    const index = _.findIndex(defaultTheme, {id: newStyle.id});
    newTheme.splice(index, 1, newStyle);
  });

  return newTheme;
}

function makeEmptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: []
  };
}

export default Map