import json
from flask import Flask, jsonify, request

import networkx as nx
import numpy as np
import peartree as pt

app = Flask(__name__)

def make_trimmed_graph():
    G = pt.utilities.graph_from_zip('data/act_network.zip')
    G.graph['crs'] = {'init': 'epsg:4326'}
    G.graph['name'] = 'foo'

    G_trimmed = G.copy()

    xmax = -122.215516
    xmin = -122.344887
    ymax = 37.835123
    ymin = 37.782774

    for i in list(G_trimmed.nodes()):
        n = G_trimmed.node[i]
        x = n['x']
        y = n['y']
        
        xok = (x <= xmax) and (x >= xmin)
        yok = (y <= ymax) and (y >= ymin)
        
        if not xok or not yok:
            G_trimmed.remove_node(i)

    return G_trimmed

G_trimmed_global = make_trimmed_graph()
orig_node_scores = nx.betweenness_centrality(G_trimmed_global)
print(' * Loaded graph and calculated node centrality')


@app.route('/healthy')
def healthy():
    return 'healthy'


@app.route('/baseline_analysis')
def return_baseline_analysis():
    a = np.array([orig_node_scores[k] for k in orig_node_scores.keys()])
    tenth_pct = np.percentile(a, 10)
    fiftieth_pct = np.percentile(a, 50)
    ninetieth_pct = np.percentile(a, 90)

    # Generate betweenness centrality as a output measure feature
    # and sort by quantiles (10th, 90th percentiles)
    centrality_fc = {
        'type': 'FeatureCollection',
        'features': []}
    for i, node in G_trimmed_global.nodes(data=True):
        centrality = round(orig_node_scores[i], 5)
        if centrality >= ninetieth_pct:
            centrality_fc['features'].append({
                'type': 'Feature',
                'geometry': {
                    'type': 'Point',
                    'coordinates': [node['x'], node['y']]
                },
                'properties': {
                    'centrality': centrality - fiftieth_pct,
                    'type': 'strong'
                }
            })
        elif centrality <= tenth_pct:
            centrality_fc['features'].append({
                'type': 'Feature',
                'geometry': {
                    'type': 'Point',
                    'coordinates': [node['x'], node['y']]
                },
                'properties': {
                    'centrality': fiftieth_pct - centrality,
                    'type': 'weak'
                }
            })

    res = {
        'centrality': centrality_fc
    }
    return jsonify(res)


@app.route('/analyze', methods=['POST'])
def analyze():
    G_temp = G_trimmed_global.copy()


    sent_gj = json.loads(request.data)
    new_feats = []
    for feat in sent_gj['features']:
        feat['properties'] = {
            'headway': 900,
            'average_speed': 16,
            'stop_distance_distribution': 402}
        feat['geometry']['coordinates'] = feat['geometry']['coordinates'][:5]
        new_feats.append(feat)
    sent_gj['features'] = new_feats

    G2 = pt.load_synthetic_network_as_graph(sent_gj, existing_graph=G_temp)
    nodes_new_score = nx.betweenness_centrality(G2)

    change_impacts = {
        'type': 'FeatureCollection',
        'features': []}
    for nok in orig_node_scores.keys():
        orig_val = orig_node_scores[nok]
        new_val = nodes_new_score[nok]
        if orig_val == 0 and new_val > 0:
            change = 1
        elif orig_val == 0 and new_val == 0:
            change = 0
        else:
            diff = (new_val - orig_val)
            change = (diff / orig_val)
        
        n = G_temp.node[nok]
        x = n['x']
        y = n['y']
        
        # Do not return values that have no change
        if change > 0:
            change_impacts['features'].append({
                'type': 'Feature',
                'geometry': {
                    'type': 'Point',
                    'coordinates': [x, y]
                },
                'properties': {
                    'percent_change': change
                }
            })

    return jsonify(change_impacts)
