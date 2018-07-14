import React, { Component } from 'react';
import _ from 'lodash';
import axios from 'axios';
import turf from 'turf';
import dissolve from '@turf/dissolve'

import defaultTheme from 'mapbox-gl-draw/src/lib/theme.js';
import MapboxGl from 'mapbox-gl/dist/mapbox-gl.js';
import MapboxDraw from 'mapbox-gl-draw';
import mbxClient from '@mapbox/mapbox-sdk';
import mbxMapMatching from '@mapbox/mapbox-sdk/services/map-matching';

// Also load in css
import 'mapbox-gl/dist/mapbox-gl.css'
import 'mapbox-gl-draw/dist/mapbox-gl-draw.css'
import 'font-awesome/css/font-awesome.min.css'

const MAPBOX_PUBLIC_TOKEN = 'pk.eyJ1Ijoia3VhbmIiLCJhIjoidXdWUVZ2USJ9.qNKXXP6z9_fKA8qrmpOi6Q';

class Map extends Component {
  constructor (props) {
    super(props);

    this.updateCustomLine = this.updateCustomLine.bind(this);
    this.updateFromDelete = this.updateFromDelete.bind(this);
    this.makeRunButton = this.makeRunButton.bind(this);
    this.makeAnalyzeBaseButton = this.makeAnalyzeBaseButton.bind(this);
    this.makeClearResultsButton = this.makeClearResultsButton.bind(this);
    this.makeGraphAnalysisQuery = this.makeGraphAnalysisQuery.bind(this);
    this.makeBaselineAnalysisQuery = this.makeBaselineAnalysisQuery.bind(this);
    this.makeLegend = this.makeLegend.bind(this);

    // Initialize state on component mount
    this.state = {
      map: null,
      draw: null,
      baselineAnalysis: null,
      addedRoutes: makeEmptyFeatureCollection(),
      analysisIsStale: true,
      runAnalysisButtonText: 'Run network analysis'
    };
  }

  // Speed up re-renders by specifying what we need
  // React to keep track of
  shouldComponentUpdate(nextProps, nextState) {
    const a = nextState.addedRoutes !== this.state.addedRoutes;
    const b = nextState.analysisIsStale !== this.state.analysisIsStale;
    const c = nextState.runAnalysisButtonText !== this.state.runAnalysisButtonText;
    const d = nextState.baselineAnalysis !== this.state.baselineAnalysis;
    return a || b || c || d;
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
      networkShape.features = networkShape.features.map(line => {
        line.properties.color = generateRandomColor();
        return simplifyLine(line);
      });

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

      // Add baseline analysis source
      map.addSource('baselineAnalysis', {
          type: 'geojson',
          data: makeEmptyFeatureCollection(),
      });

      map.addLayer({
        id: 'baselineAnalysis',
        source: 'baselineAnalysis',
        type: 'circle',
        paint: {
          'circle-stroke-color': {
            property: 'type',
            type: 'categorical',
            stops: [
              ['weak', '#ef9b00'],
              ['strong', '#0c50ff']]
          },
          'circle-radius': {
            property: 'centrality',
            type: 'exponential',
            stops: [
              [0.0, 0],
              [0.001, 0.5],
              [0.01, 1],
              [0.025, 2],
              [0.05, 4],
              [0.075, 8],
              [0.10, 12],
              [0.20, 16],
              [0.50, 20],
            ]
          },
          'circle-color': {
            property: 'type',
            type: 'categorical',
            stops: [
              ['weak', '#ffc568'],
              ['strong', '#6691ff']]
          },
          'circle-opacity': 0.75,
          'circle-stroke-width':  {
            property: 'centrality',
            type: 'exponential',
            stops: [
              [0.0, 0],
              [0.001, 0.5],
              [0.01, 1],
              [0.20, 2],
            ]
          },
        }
      });

      // And add a placeholder source for when we get responses from
      // the backend from analysis runs
      map.addSource('analysisResults', {
          type: 'geojson',
          data: makeEmptyFeatureCollection(),
      });

      map.addLayer({
        id: 'analysisResults',
        source: 'analysisResults',
        type: 'circle',
        paint: {
          'circle-stroke-color': {
            stops: [
              [-0.50, '#ff0000'],
              [-0.20, '#ff0000'],
              [-0.10, '#ff0000'],
              [-0.05, '#ff0000'],
              [-0.01, '#ff0000'],
              [0.0, '#cccccc'],
              [0.01, '#00ff04'],
              [0.05, '#00ff04'],
              [0.10, '#00ff04'],
              [0.20, '#00ff04'],
              [0.50, '#00ff04'],
            ]
          },
          'circle-radius': {
            property: 'percent_change',
            type: 'exponential',
            stops: [
              [-0.50, 10],
              [-0.20, 8],
              [-0.10, 6],
              [-0.05, 4],
              [-0.01, 2],
              [0.0, 0],
              [0.01, 2],
              [0.05, 4],
              [0.10, 6],
              [0.20, 8],
              [0.50, 10],
            ]
          },
          'circle-color': 'rgba(0,0,0,0)',
          'circle-opacity': 1,
          'circle-stroke-width':  {
            property: 'percent_change',
            type: 'exponential',
            stops: [
              [-0.20, 2],
              [-0.01, 1],
              [0.0, 0],
              [0.01, 1],
              [0.20, 2],
            ]
          },
        }
      });
    })
  }

  updateFromDelete(e) {
    const draw = this.state.draw;
    this.setState({
      addedRoutes: draw.getAll(),
      analysisIsStale: true,
    });

    // Also drop the abalysis results since they are no longer fresh
    const efc = makeEmptyFeatureCollection();
    this.state.map.getSource('analysisResults').setData(efc);
  }

  updateCustomLine(e) {
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
      tidy: true,
      profile: 'walking',  // since driving leads to oversensitivity
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
      this.setState({
        addedRoutes: draw.getAll(),
        analysisIsStale: true,
      });
    });
  }

  makeRunButton() {
    return (
      <div className='tl-button run-analysis-button'
           onClick={this.makeGraphAnalysisQuery}>
        {this.state.runAnalysisButtonText}
      </div>
    );
  }

  makeClearResultsButton() {
    return (
      <div className='tl-button clear-analysis-button'
           onClick={() => {
            const efc = makeEmptyFeatureCollection();
            this.state.map.getSource('analysisResults').setData(efc);
            this.setState({ analysisIsStale: true, });
           }}>
        Clear analysis results
      </div>
    );
  }

  makeAnalyzeBaseButton() {
    // TODO: Button additions should be dynamic
    // Figure out if this should be first of second button
    let otherClass = '';
    const fs = this.state.addedRoutes.features;
    const fsOk = fs && (fs.length > 0);
    const showOkIsStale = this.state.analysisIsStale && fsOk;
    const showOkIsFresh = !this.state.analysisIsStale && fsOk;
    if (showOkIsStale || showOkIsFresh) {
      otherClass = 'second-button';
    }

    if (!this.state.baselineAnalysis) {
      return (
        <div className={`tl-button ${otherClass}`}
             onClick={this.makeBaselineAnalysisQuery}>
          <i className="fa fa-eye"></i> View Baseline Analysis
        </div>
      );
    } else {
      return (
        <div className={`tl-button ${otherClass}`}
             onClick={() => {
              this.setState({
                baselineAnalysis: null,
              });
              const efc = makeEmptyFeatureCollection();
              this.state.map.getSource('baselineAnalysis').setData(efc);
             }}>
          <i className="fa fa-eye-slash"></i> Hide Baseline Analysis
        </div>
      );
    }
  }

  makeBaselineAnalysisQuery(e) {
    axios.get('http://127.0.0.1:5000/baseline_analysis')
    .then(res => {
      const cProcessed = res.data.centrality;

      this.setState({
        baselineAnalysis: {
          centrality: cProcessed,
        }
      });
      
      // And add to the map
      this.state.map.getSource('baselineAnalysis').setData(cProcessed);
    });
  }

  makeGraphAnalysisQuery(e) {
    this.setState({
      runAnalysisButtonText: 'Querying...',
    });
    const ar = this.state.addedRoutes;

    // Before posting, clear the current baseline if it is
    // shown on map
    const efc = makeEmptyFeatureCollection();
    this.state.map.getSource('baselineAnalysis').setData(efc);

    axios.post('http://127.0.0.1:5000/analyze', ar)
    .then(res => {
      // Do something with the result
      this.state.map.getSource('analysisResults').setData(res.data);

      // Also analysis is now up to date
      this.setState({
        analysisIsStale: false,
        runAnalysisButtonText: 'Run network analysis'
      });
    });
  }

  makeLegend() {
    const configureValues = [
      {key: 'High-access Node (B)', color: '#6691ff'},
      {key: 'Low-access Node (B)', color: '#ffc568'},
      {key: 'Improved Relative Access (AF)', color: '#00ff04'},
      {key: 'Decreased Relative Access (AF)', color: '#ff0000'},
    ]
    const mappedVals = configureValues.map((cv, i) => {
      const styles = {
        width: '10px',
        height: '10px',
        margin: '0 5px',
        backgroundColor: cv.color
      };
      return (
        <div key={`${cv.key}_${i}`}>
          <span style={styles}></span>
          {cv.key}
        </div>
      );
    });
    return (
      <div id='legend'
           className='legend'>
        <h4>Analysis Feedback Legend</h4>
        <p>B = Baseline, AF = Analysis Feedback</p>
        {mappedVals}
      </div>
    );
  }

  render() {
    // Note use of ref here allows us to pass the container to
    // the mapbox mount step
    const fs = this.state.addedRoutes.features;
    const fsOk = fs && (fs.length > 0);
    const showOkIsStale = this.state.analysisIsStale && fsOk;
    const showOkIsFresh = !this.state.analysisIsStale && fsOk;

    // Generate button if one should be made
    let topLeftButton = null
    if (showOkIsStale) {
      topLeftButton = this.makeRunButton();
    } else if (showOkIsFresh) {
      topLeftButton = this.makeClearResultsButton();
    }

    return (
      <div className='mapbox-map'
           ref={(x) => { this.container = x; }}>
        {topLeftButton}
        {this.makeAnalyzeBaseButton()}
        {this.makeLegend()}
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